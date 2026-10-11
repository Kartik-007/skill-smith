"""Durable work queue in Atlas: atomic claim with a lease, heartbeats, and token-checked transactional commits.

A worker that dies mid-step simply stops heartbeating; its lease expires and another worker claims the step
(attempt 2) and resumes from the previous step's physics checkpoint. A zombie worker whose lease was taken
over can't commit: its transaction filters on the lease token and aborts.
"""
import os
import socket
import threading
import uuid
from datetime import timedelta

from pymongo import ReturnDocument

from . import db as dbm

LEASE_S = 8 if os.environ.get("SKILLSMITH_DEMO") == "1" else 30
HEARTBEAT_S = 2 if os.environ.get("SKILLSMITH_DEMO") == "1" else 5
OWNER = f"{socket.gethostname()}:{os.getpid()}"
N_PLACE = 3


class LostLease(Exception):
    pass


def step_id(order_run_id: str, step_idx: int) -> str:
    return f"{order_run_id}:{step_idx}"


def enqueue_batch(batch_id: str, version: int, runs: list[dict], kind: str = "eval", generation: int = 0,
                  render: bool = False) -> None:
    """runs = [{"order_id", "suite", "repeat", "version"?}]. Steps: plan, place x3, verify, chained."""
    d = dbm.db()
    now = dbm.now()
    docs = []
    for r in runs:
        v = r.get("version", version)
        orid = f"{batch_id}:{r['order_id']}:v{v}:r{r['repeat']}"
        kinds = ["plan"] + ["place"] * N_PLACE + ["verify"]
        for i, k in enumerate(kinds):
            docs.append({
                "_id": step_id(orid, i), "batch_id": batch_id, "order_run_id": orid, "order_id": r["order_id"],
                "suite": r["suite"], "version": v, "repeat": r["repeat"], "step_idx": i, "kind": k,
                "waiting_on": [] if i == 0 else [step_id(orid, i - 1)], "status": "pending", "lease": None,
                "attempts": 0, "render": render, "created_at": now, "updated_at": now,
            })
    d.batches.update_one({"_id": batch_id}, {"$setOnInsert": {
        "version": version, "kind": kind, "suites": sorted({r["suite"] for r in runs}),
        "repeats": max(r["repeat"] for r in runs) + 1, "status": "running", "n_steps": len(docs),
        "created_at": now, "generation": generation}}, upsert=True)
    existing = {x["_id"] for x in d.work_queue.find({"batch_id": batch_id}, {"_id": 1})}
    new = [x for x in docs if x["_id"] not in existing]
    if new:
        d.work_queue.insert_many(new, ordered=False)


def claim(batch_ids: list[str] | None = None) -> dict | None:
    d = dbm.db()
    now = dbm.now()
    filt = {"$or": [{"status": "pending", "waiting_on": []},
                    {"status": "leased", "lease.expires_at": {"$lt": now}}]}
    if batch_ids:
        filt = {"$and": [filt, {"batch_id": {"$in": batch_ids}}]}
    token = uuid.uuid4().hex
    return d.work_queue.find_one_and_update(
        filt,
        {"$set": {"status": "leased", "updated_at": now,
                  "lease": {"owner": OWNER, "token": token, "expires_at": now + timedelta(seconds=LEASE_S)}},
         "$inc": {"attempts": 1}},
        sort=[("created_at", 1), ("order_run_id", 1), ("step_idx", 1)],
        return_document=ReturnDocument.AFTER,
    )


class Heartbeat:
    """Extends the lease every HEARTBEAT_S seconds while a step runs."""

    def __init__(self, step: dict):
        self.step, self.stop_ev, self.lost = step, threading.Event(), False
        self.t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop_ev.wait(HEARTBEAT_S):
            res = dbm.db().work_queue.update_one(
                {"_id": self.step["_id"], "lease.token": self.step["lease"]["token"], "status": "leased"},
                {"$set": {"lease.expires_at": dbm.now() + timedelta(seconds=LEASE_S), "updated_at": dbm.now()}})
            if res.matched_count == 0:
                self.lost = True
                return

    def __enter__(self):
        self.t.start()
        return self

    def __exit__(self, *exc):
        self.stop_ev.set()


def commit(step: dict, writes) -> None:
    """Run `writes(session)` and mark the step done in one transaction, only if we still hold the lease."""
    d = dbm.db()
    with dbm.client().start_session() as s:
        def txn(session):
            res = d.work_queue.update_one(
                {"_id": step["_id"], "status": "leased", "lease.token": step["lease"]["token"]},
                {"$set": {"status": "done", "lease": None, "updated_at": dbm.now(), "done_at": dbm.now()}},
                session=session)
            if res.matched_count == 0:
                raise LostLease(f"lease on {step['_id']} was taken over; discarding this worker's results")
            writes(session)
            d.work_queue.update_many({"batch_id": step["batch_id"], "waiting_on": step["_id"]},
                                     {"$pull": {"waiting_on": step["_id"]}}, session=session)
        s.with_transaction(txn)


def fail(step: dict, error: str) -> None:
    dbm.db().work_queue.update_one({"_id": step["_id"], "lease.token": step["lease"]["token"]},
                                   {"$set": {"status": "failed", "error": error[:500], "updated_at": dbm.now()}})


def batch_remaining(batch_id: str) -> int:
    return dbm.db().work_queue.count_documents({"batch_id": batch_id, "status": {"$ne": "done"}})


def batch_failed(batch_id: str) -> int:
    return dbm.db().work_queue.count_documents({"batch_id": batch_id, "status": "failed"})
