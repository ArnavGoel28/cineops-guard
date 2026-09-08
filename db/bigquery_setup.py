"""
BigQuery / Vector Search RAG Grounding setup for CineOps Guard.
Provides schemas and helpers for vector embedding index management.
"""

import os
from typing import List, Dict, Any

# BigQuery vector dataset & table definitions
DATASET_ID = os.getenv("BIGQUERY_DATASET", "cineops_guard")
SCRIPT_EMBEDDINGS_TABLE = "script_embeddings"
COMPLIANCE_EMBEDDINGS_TABLE = "compliance_history_embeddings"

def get_bigquery_schema_ddl() -> str:
    """Returns BigQuery DDL for script and compliance history vector tables."""
    return f"""
    CREATE SCHEMA IF NOT EXISTS `{DATASET_ID}`;

    CREATE TABLE IF NOT EXISTS `{DATASET_ID}.{SCRIPT_EMBEDDINGS_TABLE}` (
        scene_id STRING NOT NULL,
        production_id STRING NOT NULL,
        scene_number STRING,
        content_chunk STRING NOT NULL,
        embedding ARRAY<FLOAT64>,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
    );

    CREATE TABLE IF NOT EXISTS `{DATASET_ID}.{COMPLIANCE_EMBEDDINGS_TABLE}` (
        check_id STRING NOT NULL,
        scene_id STRING NOT NULL,
        stunt_type STRING,
        status STRING NOT NULL,
        violations JSON,
        embedding ARRAY<FLOAT64>,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
    );
    """

def embed_text_fallback(text: str) -> List[float]:
    """Fallback 768-dim mock vector embedding generator when Vertex AI is unconfigured."""
    import hashlib
    # Deterministic mock 768-dim vector from text hash
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    vec = [(b / 255.0) - 0.5 for b in digest]
    # Tile to 768 float values
    return (vec * (768 // len(vec) + 1))[:768]

if __name__ == "__main__":
    print("BigQuery RAG Grounding DDL Schema:")
    print(get_bigquery_schema_ddl())
