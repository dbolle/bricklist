import json

import database
import main


def teardown_function():
    main._pin_hash = None


def set_key(db, value="secret-api-key-abcd"):
    setting = db.get(database.Setting, "rebrickable_api_key")
    if setting:
        setting.value = value
    else:
        db.add(database.Setting(key="rebrickable_api_key", value=value))
    db.commit()


def test_settings_never_leak_the_full_key(client, db):
    set_key(db)
    resp = client.get("/api/settings")
    data = resp.json()
    assert data["rebrickable_api_key_set"] is True
    assert data["rebrickable_api_key_masked"] == "••••abcd"
    assert "secret-api-key-abcd" not in json.dumps(data)

    resp = client.put("/api/settings", json={"rebrickable_api_key": "new-key-wxyz"})
    assert "new-key-wxyz" not in json.dumps(resp.json())
    assert resp.json()["rebrickable_api_key_masked"] == "••••wxyz"


def test_settings_when_no_key(client, db):
    data = client.get("/api/settings").json()
    assert data["rebrickable_api_key_set"] is False
    assert data["rebrickable_api_key_masked"] == ""
    assert data["pin_set"] is False


def test_pin_lifecycle_guards_api(client, db):
    # no PIN: everything open
    assert client.get("/api/projects").status_code == 200

    # set a PIN
    assert client.post("/api/security/pin", json={"new_pin": "1234"}).json()["pin_set"] is True

    # guarded without credentials; header or cookie unlocks
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects",
                      headers={"X-BrickList-Pin": "1234"}).status_code == 200
    assert client.get("/api/projects", cookies={"bricklist_pin": "1234"}).status_code == 200
    assert client.get("/api/projects",
                      headers={"X-BrickList-Pin": "9999"}).status_code == 401

    # verify endpoint stays reachable while locked
    assert client.post("/api/security/pin/verify", json={"pin": "9999"}).json()["ok"] is False
    assert client.post("/api/security/pin/verify", json={"pin": "1234"}).json()["ok"] is True

    # change requires the current PIN
    resp = client.post("/api/security/pin",
                       json={"new_pin": "5678", "current_pin": "wrong"},
                       headers={"X-BrickList-Pin": "1234"})
    assert resp.status_code == 403
    resp = client.post("/api/security/pin",
                       json={"new_pin": "5678", "current_pin": "1234"},
                       headers={"X-BrickList-Pin": "1234"})
    assert resp.json()["pin_set"] is True
    assert client.get("/api/projects",
                      headers={"X-BrickList-Pin": "5678"}).status_code == 200

    # clear it
    client.post("/api/security/pin",
                json={"new_pin": "", "current_pin": "5678"},
                headers={"X-BrickList-Pin": "5678"})
    assert client.get("/api/projects").status_code == 200


def test_pin_length_validated(client, db):
    resp = client.post("/api/security/pin", json={"new_pin": "12"})
    assert resp.status_code == 400


def test_pin_survives_restart(client, db):
    client.post("/api/security/pin", json={"new_pin": "1234"})
    # simulate process restart: cache cleared, then lifespan reload
    main._pin_hash = None
    main._load_pin_hash()
    assert main._pin_hash is not None
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects",
                      headers={"X-BrickList-Pin": "1234"}).status_code == 200


def test_spa_and_static_paths_not_guarded(client, db):
    client.post("/api/security/pin", json={"new_pin": "1234"})
    # non-/api paths (app shell, sw.js) must load so the PIN screen can render.
    # In tests FRONTEND_DIST doesn't exist so the route 404s — the point is
    # the guard must not return 401.
    assert client.get("/").status_code != 401
