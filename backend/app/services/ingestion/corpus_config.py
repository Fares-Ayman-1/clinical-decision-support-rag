"""Loads config/corpus.yaml and config/heading_profiles/*.yaml.

This is the single place that reads the D1 tiering mechanism
(ARCHITECTURE.md §5.2) — enabling/disabling a document is a config change
here, never a code change in the ingestion pipeline itself.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
CORPUS_CONFIG_PATH = REPO_ROOT / "config" / "corpus.yaml"


@dataclass(frozen=True)
class DocumentConfig:
    document_id: str
    title: str
    organization: str
    tier: int
    enabled: bool
    file: pathlib.Path
    domains: list[str]
    heading_profile: pathlib.Path
    license: str
    source_url: str
    publication_year: int | str | None
    prescribing_restricted: bool = False
    has_evidence_grades: bool = False


@dataclass(frozen=True)
class CorpusConfig:
    kb_version: str
    documents: list[DocumentConfig] = field(default_factory=list)

    def enabled_documents(self) -> list[DocumentConfig]:
        return [d for d in self.documents if d.enabled]

    def get(self, document_id: str) -> DocumentConfig:
        for d in self.documents:
            if d.document_id == document_id:
                return d
        raise KeyError(f"Unknown document_id: {document_id!r}")


def load_corpus_config(path: pathlib.Path = CORPUS_CONFIG_PATH) -> CorpusConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    documents = [
        DocumentConfig(
            document_id=d["document_id"],
            title=d["title"],
            organization=d["organization"],
            tier=d["tier"],
            enabled=d["enabled"],
            file=REPO_ROOT / d["file"],
            domains=list(d["domains"]),
            heading_profile=REPO_ROOT / d["heading_profile"],
            license=d["license"],
            source_url=d["source_url"],
            publication_year=d.get("publication_year"),
            prescribing_restricted=d.get("prescribing_restricted", False),
            has_evidence_grades=d.get("has_evidence_grades", False),
        )
        for d in raw["documents"]
    ]
    return CorpusConfig(kb_version=str(raw["kb_version"]), documents=documents)


def load_heading_profile(path: pathlib.Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))
