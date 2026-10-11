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
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)["data"]
            return [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
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


def add(kind: str, text: str, **fields) -> None:
    vec = embed([text])[0]
    dbm.db().memory.insert_one({"kind": kind, "text": text, "embedding": vec, "active": True,
                                "created_at": dbm.now(), **fields})


def search(kind: str, query: str, k: int, min_score: float) -> list[dict]:
    if k <= 0:
        return []
    qvec = embed([query], input_type="query")[0]
    pipeline = [
        {"$vectorSearch": {"index": INDEX, "path": "embedding", "queryVector": qvec, "numCandidates": 100,
                           "limit": k * 3, "filter": {"kind": kind, "active": True}}},
        {"$project": {"embedding": 0, "score": {"$meta": "vectorSearchScore"}}},
    ]
    hits = [h for h in dbm.db().memory.aggregate(pipeline) if h["score"] >= min_score]
    # de-duplicate identical texts, keep best score
    seen, out = set(), []
    for h in hits:
        if h["text"] not in seen:
            seen.add(h["text"])
            out.append(h)
    return out[:k]


def retrieve_for_order(order_view: dict, retrieval: dict) -> tuple[list[dict], list[dict]]:
    """Per item, retrieve skills; for the whole order, retrieve lessons."""
    lessons, skills = [], []
    if retrieval["lessons_k"] > 0:
        q = "; ".join(f"{it['label']}: {it['description']}" for it in order_view["items"])
        lessons = search("lesson", q, retrieval["lessons_k"], retrieval["min_score"])
    if retrieval["skills_k"] > 0:
        per_item = max(1, retrieval["skills_k"] // max(1, len(order_view["items"])) + 1)
        for it in order_view["items"]:
            skills += search("skill", f"{it['label']}: {it['description']}", per_item, retrieval["min_score"])
        seen, uniq = set(), []
        for s in sorted(skills, key=lambda s: -s["score"]):
            if s["text"] not in seen:
                seen.add(s["text"])
                uniq.append(s)
        skills = uniq[: retrieval["skills_k"] + len(order_view["items"])]
    return lessons, skills
