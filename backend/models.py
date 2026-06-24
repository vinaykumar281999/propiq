"""Python dataclasses for PropIQ data models (no SQLAlchemy)."""
from dataclasses import dataclass

# Column order matches the SELECT * column order in each table
NBHD_COLS = [
    "id", "name", "metro", "price", "expected_return",
    "days_on_market", "lat", "lng", "h3_7", "h3_9",
]
AMENITY_COLS = ["id", "osm_id", "type", "name", "lat", "lng", "h3_7", "h3_9"]
TRACT_COLS   = [
    "tract_id", "county_fips", "total_pop", "pop_under_18",
    "median_income", "lat", "lng", "h3_7",
]


@dataclass
class Neighborhood:
    id: int
    name: str
    metro: str | None
    price: float
    expected_return: float
    days_on_market: float | None
    lat: float | None
    lng: float | None
    h3_7: str | None
    h3_9: str | None = None

    @property
    def roi_pct(self) -> float:
        return round((self.expected_return / self.price) * 100, 2) if self.price else 0.0

    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "name":            self.name,
            "metro":           self.metro,
            "price":           self.price,
            "expected_return": self.expected_return,
            "roi_pct":         self.roi_pct,
            "days_on_market":  self.days_on_market,
            "lat":             self.lat,
            "lng":             self.lng,
            "h3_7":            self.h3_7,
            "h3_9":            self.h3_9,
            "h3_index":        self.h3_7,   # kept for frontend backward-compat
        }

    @classmethod
    def from_row(cls, row: tuple) -> "Neighborhood":
        return cls(**dict(zip(NBHD_COLS, row)))


@dataclass
class Amenity:
    id: int
    osm_id: int | None
    type: str
    name: str | None
    lat: float
    lng: float
    h3_7: str | None
    h3_9: str | None

    def to_dict(self) -> dict:
        return {c: getattr(self, c) for c in AMENITY_COLS}

    @classmethod
    def from_row(cls, row: tuple) -> "Amenity":
        return cls(**dict(zip(AMENITY_COLS, row)))


@dataclass
class CensusTract:
    tract_id: str
    county_fips: str | None
    total_pop: int | None
    pop_under_18: int | None
    median_income: float | None
    lat: float | None
    lng: float | None
    h3_7: str | None

    def to_dict(self) -> dict:
        return {c: getattr(self, c) for c in TRACT_COLS}

    @classmethod
    def from_row(cls, row: tuple) -> "CensusTract":
        return cls(**dict(zip(TRACT_COLS, row)))
