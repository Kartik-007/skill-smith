"""Atlas access. One client, two databases.

The truth database is only reachable through `truth_db(caller=...)`, which allows the referee/executor path
only. The sandbox would not let us create database-scoped users, so this separation is enforced in code;
agent-facing query tools go through `agent_query`, which refuses the truth database with Atlas's own
"Unauthorized" error code (13) so the tripwire looks exactly like a database permission failure.
"""
from datetime import datetime, timezone
from functools import lru_cache

from pymongo import ASCENDING, MongoClient
from pymongo.errors import OperationFailure

from .config import DB_NAME, TRUTH_DB_NAME, env

TRUTH_CALLERS = {"referee", "seed"}


@lru_cache(maxsize=1)
def client() -> MongoClient:
    return MongoClient(env("MONGODB_URI"), appname="skill-smith", serverSelectionTimeoutMS=20000,
                       retryWrites=True, w="majority")


def db():
    return client()[DB_NAME]


def truth_db(caller: str):
    if caller not in TRUTH_CALLERS:
        raise OperationFailure(f"not authorized on {TRUTH_DB_NAME} to execute command", code=13)
    return client()[TRUTH_DB_NAME]


@lru_cache(maxsize=1)
def harness_client() -> MongoClient | None:
    """Optional restricted login (readWrite on skillsmith only). When set, Atlas itself enforces the wall."""
    import os
    uri = os.environ.get("MONGODB_URI_HARNESS")
    return MongoClient(uri, appname="skill-smith-harness", serverSelectionTimeoutMS=20000) if uri else None


def enforcement() -> str:
    return "atlas" if harness_client() else "code"


def agent_query(database: str, collection: str, filt: dict, limit: int = 20) -> list[dict]:
    """The meta-agent's read tool, on the harness login. The truth database is off limits."""
    hc = harness_client()
    if hc is not None:  # Atlas enforces it: the harness user has no privileges on the truth database
        return list(hc[database][collection].find(filt, {"embedding": 0}).limit(limit))
    if database != DB_NAME:
        raise OperationFailure(f"not authorized on {database} to execute command "
                               f"{{ find: \"{collection}\" }}", code=13)
    return list(db()[collection].find(filt, {"embedding": 0}).limit(limit))


def now() -> datetime:
    return datetime.now(timezone.utc)


def feed(type_: str, text: str, **refs) -> None:
    db().feed.insert_one({"ts": now(), "type": type_, "text": text, "refs": refs})


def ensure_indexes() -> None:
    d = db()
    d.products.create_index("split")
    d.orders.create_index("suite")
    d.harness_versions.create_index("version", unique=True)
    d.runs.create_index([("version", ASCENDING), ("suite", ASCENDING)])
    d.runs.create_index("batch_id")
    d.work_queue.create_index([("status", ASCENDING), ("batch_id", ASCENDING), ("order_id", ASCENDING),
                               ("step_idx", ASCENDING)])
    d.work_queue.create_index("batch_id")
    d.checkpoints.create_index([("order_run_id", ASCENDING), ("step_idx", ASCENDING)])
    d.llm_ledger.create_index("call_key", unique=True)
    d.feed.create_index("ts")
    d.batches.create_index("status")
    truth_db("seed").scene_truth.create_index([("order_id", ASCENDING), ("item_id", ASCENDING)], unique=True)
