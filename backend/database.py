import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Boolean, DateTime,
    ForeignKey, UniqueConstraint, Index, event
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////data/bricklist.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Enable WAL mode and foreign keys for SQLite
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=False, default="")


class SetModel(Base):
    __tablename__ = "sets"
    set_num = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    year = Column(Integer)
    theme_id = Column(Integer)
    num_parts = Column(Integer)
    img_url = Column(String)
    cached_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    parts = relationship("SetPart", back_populates="set", cascade="all, delete-orphan")
    projects = relationship("Project", back_populates="set")


class Color(Base):
    __tablename__ = "colors"
    color_id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    rgb = Column(String, nullable=False)

    parts = relationship("SetPart", back_populates="color")


class SetPart(Base):
    __tablename__ = "set_parts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    set_num = Column(String, ForeignKey("sets.set_num"), nullable=False)
    part_num = Column(String, nullable=False)
    part_name = Column(String, nullable=False)
    part_img_url = Column(String)
    color_id = Column(Integer, ForeignKey("colors.color_id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    is_spare = Column(Boolean, nullable=False, default=False)
    element_id = Column(String)

    set = relationship("SetModel", back_populates="parts")
    color = relationship("Color", back_populates="parts")
    progress_rows = relationship("PartProgress", back_populates="set_part", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("set_num", "part_num", "color_id", "is_spare"),
        Index("idx_set_parts_set_num", "set_num"),
    )


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    projects = relationship("Project", back_populates="group")


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, autoincrement=True)
    set_num = Column(String, ForeignKey("sets.set_num"), nullable=False)
    name = Column(String, nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    set = relationship("SetModel", back_populates="projects")
    group = relationship("Group", back_populates="projects")
    progress_rows = relationship("PartProgress", back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_projects_set_num", "set_num"),
        Index("idx_projects_group_id", "group_id"),
    )


class PartProgress(Base):
    __tablename__ = "part_progress"
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    set_part_id = Column(Integer, ForeignKey("set_parts.id", ondelete="CASCADE"), nullable=False)
    found_qty = Column(Integer, nullable=False, default=0)

    project = relationship("Project", back_populates="progress_rows")
    set_part = relationship("SetPart", back_populates="progress_rows")

    __table_args__ = (
        UniqueConstraint("project_id", "set_part_id"),
        Index("idx_part_progress_project", "project_id"),
    )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not db.get(Setting, "rebrickable_api_key"):
            db.add(Setting(key="rebrickable_api_key", value=""))
            db.commit()
    finally:
        db.close()
