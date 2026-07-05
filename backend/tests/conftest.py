import os
import sys

# Point the app at a throwaway database *before* database.py is imported.
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_bricklist.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import database
import main


@pytest.fixture()
def db():
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db):
    with TestClient(main.app) as c:
        yield c


def seed_set(db, set_num="1234-1", parts=((3, False), (5, False))):
    """Create a cached set with parts. `parts` is a list of (quantity, is_spare)."""
    db.add(database.Color(color_id=0, name="Black", rgb="05131D"))
    db.add(database.SetModel(set_num=set_num, name="Test Set", num_parts=99))
    db.flush()
    created = []
    for i, (qty, is_spare) in enumerate(parts):
        sp = database.SetPart(
            set_num=set_num,
            part_num=f"p{i}",
            part_name=f"Part {i}",
            color_id=0,
            quantity=qty,
            is_spare=is_spare,
        )
        db.add(sp)
        created.append(sp)
    db.flush()
    db.commit()
    return created


def seed_project(db, set_num="1234-1", name="Proj"):
    project = database.Project(set_num=set_num, name=name)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project
