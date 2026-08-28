"""
Session history persistence via Postgres.

Kept deliberately simple - raw SQL over a small connection pool, no ORM.
One table, storing each session's transcript and speaker names as JSONB
blobs (mirroring the same shape the frontend already used for its
localStorage-based history) rather than normalizing into separate tables -
this is a POC-scale feature, not a system needing complex queries.
"""
from __future__ import annotations
import json
import logging
import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2.pool import SimpleConnectionPool

logger = logging.getLogger("database")

DATABASE_URL = os.environ.get("DATABASE_URL")

_pool: SimpleConnectionPool | None = None


def init_db():
    """Creates the connection pool and the sessions table if it doesn't exist yet."""
    global _pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    _pool = SimpleConnectionPool(minconn=1, maxconn=5, dsn=DATABASE_URL)

    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    started_at BIGINT NOT NULL,
                    segments JSONB NOT NULL DEFAULT '[]',
                    speaker_names JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
        conn.commit()
    logger.info("Database initialized")


@contextmanager
def _get_conn():
    if _pool is None:
        raise RuntimeError("Database pool not initialized - call init_db() first")
    conn = _pool.getconn()
    try:
        yield conn
    finally:
        _pool.putconn(conn)


def upsert_session(session_id: str, started_at: int, segments: list, speaker_names: dict):
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions (session_id, started_at, segments, speaker_names, updated_at)
                VALUES (%s, %s, %s::jsonb, %s::jsonb, now())
                ON CONFLICT (session_id)
                DO UPDATE SET segments = EXCLUDED.segments,
                              speaker_names = EXCLUDED.speaker_names,
                              updated_at = now()
                """,
                (session_id, started_at, json.dumps(segments), json.dumps(speaker_names)),
            )
        conn.commit()


def list_sessions() -> list[dict]:
    """
    Lightweight summary list for the history panel - segment/speaker
    COUNTS only, not the full transcript text, so listing past sessions
    stays fast even as the table grows.
    """
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT session_id,
                       started_at,
                       jsonb_array_length(segments) AS segment_count,
                       (SELECT COUNT(DISTINCT seg->>'speaker')
                        FROM jsonb_array_elements(segments) AS seg) AS speaker_count
                FROM sessions
                ORDER BY started_at DESC
                LIMIT 50
            """)
            return [dict(row) for row in cur.fetchall()]


def get_session(session_id: str) -> dict | None:
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT session_id, started_at, segments, speaker_names FROM sessions WHERE session_id = %s",
                (session_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def delete_session(session_id: str):
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
        conn.commit()