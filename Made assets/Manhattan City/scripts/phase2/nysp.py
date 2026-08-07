"""
nysp.py -- NAD83 / New York Long Island (EPSG:2263) to WGS84.

NYC publishes a lot of its operational data in State Plane feet rather than
lat/lon: the traffic volume counts carry `wktgeom` as POINT (1035363.4
185093.4), and there is no lat/lon column. pyproj is not available in this
environment, so this is the Lambert Conformal Conic inverse written out.

Parameters are the EPSG:2263 definition:

    projection            Lambert Conformal Conic, 2 standard parallels
    ellipsoid             GRS80  (NAD83; agrees with WGS84 to well under a
                          metre in New York, far below the count data's own
                          positional accuracy)
    standard parallels    40 deg 40' N,  41 deg 02' 20" N
    latitude of origin    40 deg 10' N
    central meridian      74 deg W
    false easting         984250.0000 US survey feet  (300000 m)
    false northing        0
    unit                  US survey foot  (1200/3937 m)

Correctness is not taken on trust: verify() round-trips a set of known
Manhattan landmarks and the caller is expected to check that converted points
land on the street network rather than in New Jersey.
"""

import math

FT_US = 1200.0 / 3937.0          # US survey foot in metres

_A = 6378137.0                   # GRS80 semi-major axis, metres
_F = 1.0 / 298.257222101
_E2 = _F * (2.0 - _F)
_E = math.sqrt(_E2)

_LAT1 = math.radians(40.0 + 40.0 / 60.0)
_LAT2 = math.radians(41.0 + 2.0 / 60.0 + 20.0 / 3600.0)
_LAT0 = math.radians(40.0 + 10.0 / 60.0)
_LON0 = math.radians(-74.0)
_FE = 984250.0 * FT_US           # false easting in metres
_FN = 0.0


def _m(lat):
    s = math.sin(lat)
    return math.cos(lat) / math.sqrt(1.0 - _E2 * s * s)


def _t(lat):
    s = math.sin(lat)
    es = _E * s
    return (math.tan(math.pi / 4.0 - lat / 2.0) /
            ((1.0 - es) / (1.0 + es)) ** (_E / 2.0))


_M1, _M2 = _m(_LAT1), _m(_LAT2)
_T1, _T2, _T0 = _t(_LAT1), _t(_LAT2), _t(_LAT0)
_N = (math.log(_M1) - math.log(_M2)) / (math.log(_T1) - math.log(_T2))
_F_ = _M1 / (_N * _T1 ** _N)
_R0 = _A * _F_ * _T0 ** _N


def to_wgs84(east_ft, north_ft):
    """State Plane 2263 (US survey feet) -> (lon, lat) in degrees."""
    x = east_ft * FT_US - _FE
    y = north_ft * FT_US - _FN
    ry = _R0 - y
    r = math.copysign(math.hypot(x, ry), _N)
    t = (r / (_A * _F_)) ** (1.0 / _N)
    theta = math.atan2(x, ry)

    lon = theta / _N + _LON0
    # iterate the isometric latitude; converges in three or four passes
    lat = math.pi / 2.0 - 2.0 * math.atan(t)
    for _ in range(12):
        es = _E * math.sin(lat)
        nxt = (math.pi / 2.0 - 2.0 * math.atan(
            t * ((1.0 - es) / (1.0 + es)) ** (_E / 2.0)))
        if abs(nxt - lat) < 1e-12:
            lat = nxt
            break
        lat = nxt
    return math.degrees(lon), math.degrees(lat)


def to_sp(lon_deg, lat_deg):
    """(lon, lat) degrees -> State Plane 2263 in US survey feet. Forward, kept
    so the inverse can be round-tripped rather than believed."""
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    r = _A * _F_ * _t(lat) ** _N
    theta = _N * (lon - _LON0)
    x = _FE + r * math.sin(theta)
    y = _FN + _R0 - r * math.cos(theta)
    return x / FT_US, y / FT_US


def parse_point(wkt):
    """'POINT (1035363.4 185093.4)' -> (east_ft, north_ft), or None."""
    if not wkt or "POINT" not in wkt.upper():
        return None
    try:
        inner = wkt[wkt.index("(") + 1:wkt.rindex(")")]
        a, b = inner.replace(",", " ").split()
        return float(a), float(b)
    except (ValueError, IndexError):
        return None


# Landmarks with independently known coordinates, used as control points.
CONTROL = [
    ("Empire State Building", -73.985664, 40.748440),
    ("Grand Central Terminal", -73.977295, 40.752726),
    ("One World Trade Center", -74.013382, 40.712742),
    ("Columbus Circle", -73.981926, 40.768045),
    ("The Cloisters", -73.931553, 40.864850),
]


def verify(verbose=True):
    """Round-trip the control points. Returns the worst error in metres."""
    worst = 0.0
    for name, lon, lat in CONTROL:
        e, n = to_sp(lon, lat)
        lon2, lat2 = to_wgs84(e, n)
        dx = (lon2 - lon) * 111320.0 * math.cos(math.radians(lat))
        dy = (lat2 - lat) * 110574.0
        err = math.hypot(dx, dy)
        worst = max(worst, err)
        if verbose:
            print("  %-24s E %10.1f  N %10.1f   round-trip %.6f m"
                  % (name, e, n, err))
    return worst


if __name__ == "__main__":
    print("EPSG:2263 round-trip check")
    print("  worst error: %.9f m" % verify())
