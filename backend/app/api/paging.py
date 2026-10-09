"""Bounded lists (Phase 8 final, CX-04).

Every collection that grows with use is read one page at a time, *in the database query*: `?limit=` (default
50, at most 200) and `?offset=`. The response body stays a plain list, so existing clients keep working; when
more rows exist the response carries `X-Next-Offset` (exposed to the desktop app through CORS). A request can
never make the API load a whole table.
"""

from dataclasses import dataclass
from typing import Annotated, TypeVar

from fastapi import Depends, Query, Response
from sqlalchemy import Select

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_OFFSET = 100_000
NEXT_OFFSET_HEADER = "X-Next-Offset"

T = TypeVar("T")


@dataclass(frozen=True)
class Page:
    limit: int = DEFAULT_LIMIT
    offset: int = 0

    def apply(self, query: Select) -> Select:
        """One row more than asked for, to know whether another page exists."""
        return query.limit(self.limit + 1).offset(self.offset)

    def finish(self, rows: list[T], response: Response | None) -> list[T]:
        if len(rows) > self.limit and response is not None:
            response.headers[NEXT_OFFSET_HEADER] = str(self.offset + self.limit)
        return rows[: self.limit]


def page_params(
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0, le=MAX_OFFSET)] = 0,
) -> Page:
    return Page(limit=limit, offset=offset)


PageDep = Annotated[Page, Depends(page_params)]

#: Lists scoped to one assessment or interview (its results, its candidates' progress) are not paged —
#: their statistics need every row — but never return more than this.
SCOPED_CEILING = 1000
