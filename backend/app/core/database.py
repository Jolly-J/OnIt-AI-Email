from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool
from app.core.config import settings

if settings.MOCK_MODE:
    # 纯内存隔离数据库：零文件 IO、零磁盘读写、零脏数据污染，停机即自动销毁
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
else:
    connect_args = {"check_same_thread": False, "timeout": 30} if "sqlite" in settings.DATABASE_URL else {}
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args=connect_args,
        pool_size=30,
        max_overflow=50,
        pool_timeout=30.0,
        pool_recycle=1800,
        pool_pre_ping=True
    )

    # 如果是 SQLite 磁盘文件库，开启 WAL 模式提升并发性能
    if "sqlite" in settings.DATABASE_URL and ":memory:" not in settings.DATABASE_URL:
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=15000")
            cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
