"""Lessons and skills in Atlas, retrieved with Vector Search (one index serves both, pre-filtered by kind)."""
import json
import time
import urllib.request

from . import db as dbm
from .config import env

INDEX = "memory_vector"
EMBED_MODEL = "voyage-3.5-lite"
DIMS = 1024


def embed(texts: list[str], input_type: str = "document") -> list[list[float]]:
    body = json.dumps({"input": texts, "model": EMBED_MODEL, "input_type": input_type}).encode()
    req = urllib.request.Request("https://api.voyageai.com/v1/embeddings", data=body, headers={
        "Authorization": f"Bearer {env('VOYAGE_API_KEY')}", "Content-Type": "application/json"})
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)["data"]
            return [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]
        except Exception as e:
            if attempt == 6:
                raise
            # Voyage free tier allows ~3 requests/min: back off hard on 429
            time.sleep(21 if getattr(e, "code", None) == 429 else 2 * (attempt + 1))
    return []


def ensure_index() -> None:
    if "memory" not in dbm.db().list_collection_names():
        dbm.db().create_collection("memory")
    coll = dbm.db().memory
    if any(ix["name"] == INDEX for ix in coll.list_search_indexes()):
        return
    coll.create_search_index({"name": INDEX, "type": "vectorSearch", "definition": {"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": DIMS, "similarity": "cosine"},
        {"type": "filter", "path": "kind"},
        {"type": "filter", "path": "active"},
        {"type": "filter", "path": "family"},
        {"type": "filter", "path": "class"},
    ]}})


def add_many(kind: str, docs: list[dict]) -> None:
    """docs = [{"text", ...fields}]. One embedding request for all of them (Voyage free tier is ~3 req/min)."""
    if not docs:
        return
    vecs = embed([x["text"] for x in docs])
    dbm.db().memory.insert_many([{"kind": kind, "embedding": v, "active": True, "created_at": dbm.now(), **x}
                                 for x, v in zip(docs, vecs)])


def embed_pending() -> int:
    """Skills are written by workers without a vector; embed them here in one batched request."""
    coll = dbm.db().memory
    pending = list(coll.find({"needs_embed": True}, {"text": 1}).limit(128))
    if not pending:
        return 0
    vecs = embed([p["text"] for p in pending])
    for p, v in zip(pending, vecs):
        coll.update_one({"_id": p["_id"]}, {"$set": {"embedding": v}, "$unset": {"needs_embed": ""}})
    return len(pending)


_product_vecs: dict = {}


def product_vector(product_id: str) -> list[float]:
    """Product query vectors are embedded once at seed time and cached in Atlas, so retrieval at plan time costs
    no embedding calls."""
    if product_id not in _product_vecs:
        _product_vecs[product_id] = dbm.db().products.find_one({"_id": product_id}, {"embedding": 1})["embedding"]
    return _product_vecs[product_id]


def search_vec(kind: str, qvec: list[float], k: int, min_score: float) -> list[dict]:
    if k <= 0:
        return []
    pipeline = [
        {"$vectorSearch": {"index": INDEX, "path": "embedding", "queryVector": qvec, "numCandidates": 100,
                           "limit": k, "filter": {"kind": kind, "active": True}}},
        {"$project": {"embedding": 0, "score": {"$meta": "vectorSearchScore"}}},
    ]
    return [h for h in dbm.db().memory.aggregate(pipeline) if h["score"] >= min_score]


def _merge(hits: list[dict], limit: int) -> list[dict]:
    seen, out = set(), []
    for h in sorted(hits, key=lambda h: -h["score"]):
        if h["text"] not in seen:
            seen.add(h["text"])
            out.append(h)
    return out[:limit]


def retrieve_for_order(order_items: list[dict], retrieval: dict) -> tuple[list[dict], list[dict]]:
    """order_items = [{"product_id"}]. Skills: top skills_k per item. Lessons: top lessons_k across the order."""
    lessons, skills = [], []
    for it in order_items:
        vec = product_vector(it["product_id"])
        lessons += search_vec("lesson", vec, retrieval["lessons_k"], retrieval["min_score"])
        skills += search_vec("skill", vec, retrieval["skills_k"], retrieval["min_score"])
    return _merge(lessons, retrieval["lessons_k"]), _merge(skills, retrieval["skills_k"] * len(order_items))
