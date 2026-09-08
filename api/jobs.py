"""
Async job store for long-running generation tasks (storyboard, music).

Storyboard (Imagen 3) and music (Lyria 3) generation can take multiple
seconds. Rather than blocking the HTTP request, the API returns a job_id
immediately and the frontend polls /jobs/{job_id}/status.

In production this would be backed by Cloud Tasks or Pub/Sub.
For the hackathon, an in-process dict is fine (single-server).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


class Job:
    def __init__(self, job_type: str, params: Dict[str, Any]):
        self.id = str(uuid.uuid4())
        self.type = job_type
        self.params = params
        self.status = JobStatus.PENDING
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.completed_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
        }


# In-memory job store (replace with Cloud Tasks for production)
_jobs: Dict[str, Job] = {}


def create_job(job_type: str, params: Dict[str, Any]) -> Job:
    job = Job(job_type, params)
    _jobs[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    return _jobs.get(job_id)


def all_jobs() -> list[Dict[str, Any]]:
    return [j.to_dict() for j in _jobs.values()]


async def run_job_background(job: Job, coro):
    """Run a coroutine as a background task, updating job status."""
    job.status = JobStatus.RUNNING
    try:
        result = await coro
        job.result = result
        job.status = JobStatus.COMPLETE
    except Exception as exc:
        job.error = str(exc)
        job.status = JobStatus.FAILED
    finally:
        job.completed_at = datetime.now(timezone.utc).isoformat()
