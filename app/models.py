"""SQLAlchemy models.

  • ``Site``        — a study area where we track one type of surface change
                      (see ``app/change_types.py``). Curated in
                      ``app/data/sites.json``.
  • ``Scene``       — one NISAR pass over a site: date, source granule and a
                      small image of the site (``app/data/scenes/``).
  • ``Observation`` — one value of one metric on one date (e.g. HV
                      backscatter in dB, displacement in mm).
  • ``LoadJob``     — last-run state of the data loader, surfaced by
                      ``/api/health``.

Scenes and observations are written by ``app/loader.py`` from
``app/data/nisar_observations.json``.
"""
from datetime import datetime

from app import db


def acquisition_mode(granule_id):
    """A GCOV granule's acquisition mode, e.g. ``4005_DHDH`` (bandwidths, then
    polarizations of frequencies A and B); ``None`` for other products."""
    parts = (granule_id or '').split('_')
    if len(parts) > 9 and parts[3] == 'GCOV':
        return f'{parts[8]}_{parts[9]}'
    return None


def _footprint(footprint):
    if not footprint:
        return None
    out = dict(footprint)
    image = out.pop('image', None)
    out['image_url'] = f'/api/scenes/{image}' if image else None
    return out


class Site(db.Model):
    __tablename__ = 'sites'

    id = db.Column(db.Integer, primary_key=True)
    # Stable key from sites.json so reloading updates in place.
    slug = db.Column(db.String(80), unique=True, index=True)
    name = db.Column(db.String(255), nullable=False)
    change_type = db.Column(db.String(32), nullable=False, index=True)
    description = db.Column(db.Text)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    min_lon = db.Column(db.Float, nullable=False)
    min_lat = db.Column(db.Float, nullable=False)
    max_lon = db.Column(db.Float, nullable=False)
    max_lat = db.Column(db.Float, nullable=False)
    event_date = db.Column(db.Date)
    # NISAR product the site's values come from, and its track/frame.
    product = db.Column(db.String(8))
    frame = db.Column(db.String(16))
    # GUNW sites: the stable point displacement is measured against, and
    # the +/- range (mm) of the color scale in the site's images.
    reference_lon = db.Column(db.Float)
    reference_lat = db.Column(db.Float)
    image_range = db.Column(db.Float)
    # GCOV sites: the area every pass imaged, over which open water is
    # compared (scripts/shared_footprint.py): pct_of_box, passes, status,
    # method, image, and for the image method uncertainty_pp and estimated.
    footprint = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False,
    )

    observations = db.relationship(
        'Observation',
        backref='site',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='Observation.observed_on',
    )

    scenes = db.relationship(
        'Scene',
        backref='site',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='Scene.acquired_on',
    )

    @property
    def bbox(self):
        return [self.min_lon, self.min_lat, self.max_lon, self.max_lat]

    def to_dict(self, detail=False, scene_dates=None, thumb=None):
        """``detail`` adds observations and scenes. ``scene_dates`` is
        ``(count, first, last)`` and ``thumb`` the newest pass's image, if
        the caller already queried them."""
        if scene_dates is None:
            dates = [s.acquired_on for s in self.scenes]
            scene_dates = (len(dates), min(dates, default=None), max(dates, default=None))
            imaged = [s for s in self.scenes if s.image]
            thumb = max(imaged, key=lambda s: s.acquired_on).image if imaged else None
        count, first, last = scene_dates
        data = {
            'id': self.id,
            'slug': self.slug,
            'name': self.name,
            'change_type': self.change_type,
            'description': self.description,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'bbox': self.bbox,
            'event_date': self.event_date.isoformat() if self.event_date else None,
            'product': self.product,
            'frame': self.frame,
            'reference': (
                [self.reference_lon, self.reference_lat]
                if self.reference_lon is not None else None
            ),
            'image_range': self.image_range,
            'footprint': _footprint(self.footprint),
            'scene_count': count,
            'first_date': first.isoformat() if first else None,
            'last_date': last.isoformat() if last else None,
            # The newest pass's image: a small picture of the place for lists.
            'thumb_url': f'/api/scenes/{thumb}' if thumb else None,
        }
        if detail:
            data['observations'] = [o.to_dict() for o in self.observations]
            data['scenes'] = [s.to_dict() for s in self.scenes]
        return data


class Scene(db.Model):
    __tablename__ = 'scenes'

    id = db.Column(db.Integer, primary_key=True)
    site_id = db.Column(
        db.Integer, db.ForeignKey('sites.id'), nullable=False, index=True,
    )
    acquired_on = db.Column(db.Date, nullable=False)
    # GUNW scenes after the first come from the pair ending on this date.
    granule_id = db.Column(db.String(255))
    quality = db.Column(db.String(16))
    # Share of the site's bbox with valid pixels.
    valid_pct = db.Column(db.Float)
    # Path under app/data/scenes/, served at /api/scenes/<image>.
    image = db.Column(db.String(255))

    def to_dict(self):
        return {
            'date': self.acquired_on.isoformat(),
            'granule_id': self.granule_id,
            'mode': acquisition_mode(self.granule_id),
            'quality': self.quality,
            'valid_pct': self.valid_pct,
            'image_url': f'/api/scenes/{self.image}' if self.image else None,
        }


class Observation(db.Model):
    __tablename__ = 'observations'

    id = db.Column(db.Integer, primary_key=True)
    site_id = db.Column(
        db.Integer, db.ForeignKey('sites.id'), nullable=False, index=True,
    )
    observed_on = db.Column(db.Date, nullable=False)
    metric = db.Column(db.String(64), nullable=False)
    value = db.Column(db.Float, nullable=False)
    unit = db.Column(db.String(16), nullable=False, default='')
    # 'nisar' for values computed from NISAR granules (the loader owns these
    # rows); other sources (e.g. field data) are left alone by the loader.
    source = db.Column(db.String(32), nullable=False, default='nisar')
    granule_id = db.Column(db.String(255))

    def to_dict(self):
        return {
            'id': self.id,
            'observed_on': self.observed_on.isoformat(),
            'metric': self.metric,
            'value': self.value,
            'unit': self.unit,
            'source': self.source,
            'granule_id': self.granule_id,
        }


class LoadJob(db.Model):
    """Per-source snapshot of the last background loader run."""
    __tablename__ = 'load_jobs'

    source_id = db.Column(db.String(50), primary_key=True)
    last_attempt_at = db.Column(db.DateTime)
    last_success_at = db.Column(db.DateTime)
    item_count = db.Column(db.Integer, default=0)
    last_error = db.Column(db.Text)

    def to_dict(self):
        return {
            'source_id': self.source_id,
            'last_attempt_at': (
                self.last_attempt_at.isoformat() if self.last_attempt_at else None
            ),
            'last_success_at': (
                self.last_success_at.isoformat() if self.last_success_at else None
            ),
            'item_count': self.item_count or 0,
            'last_error': self.last_error,
        }
