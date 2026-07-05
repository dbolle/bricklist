import time
from datetime import datetime, timedelta

import database
import main
from conftest import seed_set


def make_stale(db, set_num="1234-1"):
    db_set = db.get(database.SetModel, set_num)
    db_set.cached_at = datetime.utcnow() - timedelta(days=main.CACHE_MAX_AGE_DAYS + 1)
    db.commit()


def set_api_key(db, value="test-key"):
    setting = db.get(database.Setting, "rebrickable_api_key")
    if setting:
        setting.value = value
    else:
        db.add(database.Setting(key="rebrickable_api_key", value=value))
    db.commit()


def test_stale_cache_served_even_if_refresh_would_fail(client, db, monkeypatch):
    """A stale cache must be returned immediately; Rebrickable being down
    (fetch raising) must not fail the request — that's the old blocking bug."""
    seed_set(db, parts=((3, False),))
    make_stale(db)
    set_api_key(db)

    async def exploding_fetch(set_num, api_key, session):
        raise RuntimeError("rebrickable is down")

    monkeypatch.setattr(main, "_fetch_and_cache_set", exploding_fetch)

    resp = client.get("/api/sets/1234-1/parts")
    assert resp.status_code == 200
    assert len(resp.json()["parts"]) == 1


def test_stale_cache_schedules_background_refresh(client, db, monkeypatch):
    seed_set(db, parts=((3, False),))
    make_stale(db)
    set_api_key(db)

    calls = []

    async def recording_fetch(set_num, api_key, session):
        calls.append(set_num)
        return db.get(database.SetModel, set_num)

    monkeypatch.setattr(main, "_fetch_and_cache_set", recording_fetch)

    resp = client.get("/api/sets/1234-1/parts")
    assert resp.status_code == 200

    deadline = time.time() + 2
    while not calls and time.time() < deadline:
        time.sleep(0.02)
    assert calls == ["1234-1"], "background refresh should have been scheduled"


def test_fresh_cache_does_not_refresh(client, db, monkeypatch):
    seed_set(db, parts=((3, False),))
    set_api_key(db)

    async def exploding_fetch(set_num, api_key, session):
        raise AssertionError("must not fetch a fresh set")

    monkeypatch.setattr(main, "_fetch_and_cache_set", exploding_fetch)

    resp = client.get("/api/sets/1234-1/parts")
    assert resp.status_code == 200


def test_stale_cache_without_api_key_skips_refresh(client, db, monkeypatch):
    """No key configured: serve the cache silently instead of erroring."""
    seed_set(db, parts=((3, False),))
    make_stale(db)
    set_api_key(db, value="")

    calls = []

    async def recording_fetch(set_num, api_key, session):
        calls.append(set_num)

    monkeypatch.setattr(main, "_fetch_and_cache_set", recording_fetch)

    resp = client.get("/api/sets/1234-1/parts")
    assert resp.status_code == 200
    time.sleep(0.1)
    assert calls == []


def test_uncached_set_fetched_synchronously(client, db, monkeypatch):
    """First-ever fetch (project creation) still blocks — nothing to serve yet."""
    set_api_key(db)
    calls = []

    async def creating_fetch(set_num, api_key, session):
        calls.append(set_num)
        db_set = database.SetModel(set_num=set_num, name="Fetched Set")
        session.add(db_set)
        session.commit()
        return db_set

    monkeypatch.setattr(main, "_fetch_and_cache_set", creating_fetch)

    resp = client.get("/api/sets/9999-1/parts")
    assert resp.status_code == 200
    assert calls == ["9999-1"], "uncached set must be fetched before responding"
