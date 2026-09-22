"""Shared field types."""

import re
from typing import Annotated

from pydantic import AfterValidator, Field

_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _normalise_email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL_PATTERN.fullmatch(value):
        raise ValueError("Enter a valid email address.")
    return value


# Deliberately pragmatic: the same shape check the desktop client applies, plus lowercasing.
# Strict RFC / deliverability validation rejects the reserved `.local` domain used by
# development accounts and is not needed for authentication.
Email = Annotated[str, Field(max_length=254), AfterValidator(_normalise_email)]
