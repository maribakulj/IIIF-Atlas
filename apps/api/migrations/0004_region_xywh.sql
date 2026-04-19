-- Sprint 4: capture-advanced. Items can now carry a region-of-interest
-- expressed as an xywh fragment ("x,y,w,h" in intrinsic image pixels).
-- The ingestion / manifest / viewer layers surface it; the cropping
-- itself is left to IIIF Image API level 1+ consumers.

ALTER TABLE items ADD COLUMN region_xywh TEXT;
