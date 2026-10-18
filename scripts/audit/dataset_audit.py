"""Read-only, resumable dataset audit. Never executes dataset code or creates previews.

API authentication, when requested, is restricted to public HF repository metadata.
Asset checks are anonymous, bounded reads; a format/header check is not a full render.
"""

import argparse
import concurrent.futures
import gzip
import hashlib
import io
import json
import math
import os
import re
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://huggingface.co"
ARCHIVES = (".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".7z")
GEOMETRY = (".obj", ".glb", ".gltf", ".las", ".laz", ".pcd", ".off", ".stl", ".splat", ".ksplat", ".usd", ".usdz")
CAMERA = re.compile(r"(?:^|/)(?:transforms(?:_[^/]*)?\.json|poses_bounds\.npy|intrinsics\.txt|extrinsics\.txt|cameras\.npz)$", re.I)
GAUSSIAN = {"x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"}
CAMERA_MODELS = {"SIMPLE_PINHOLE": 3, "PINHOLE": 4, "SIMPLE_RADIAL": 4, "RADIAL": 5, "OPENCV": 8,
                 "OPENCV_FISHEYE": 8, "FULL_OPENCV": 12, "FOV": 5, "SIMPLE_RADIAL_FISHEYE": 4,
                 "RADIAL_FISHEYE": 5, "THIN_PRISM_FISHEYE": 12, "RAD_TAN_THIN_PRISM_FISHEYE": 16,
                 "SIMPLE_DIVISION": 4, "DIVISION": 5, "SIMPLE_FISHEYE": 3, "FISHEYE": 4, "EUCM": 6,
                 "EQUIRECTANGULAR": 0}
LOCK = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".new")
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    temp.write_bytes(gzip.compress(raw) if path.suffix == ".gz" else raw)
    temp.replace(path)


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == ".gz" else raw)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Network:
    def __init__(self, token=None):
        self.token = token
        self.windows = {}
        self.lock = threading.Lock()

    def fetch(self, url, limit=65536, range_header=None, api=False, deadline=None):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
            raise ValueError("Expected a public HTTP URL")
        bucket = "api" if api else "resolvers"
        for attempt in range(3):
            while True:
                if deadline and time.monotonic() >= deadline:
                    raise TimeoutError("Per-source probe budget reached")
                with self.lock:
                    remaining, reset = self.windows.get(bucket, (1000000, 0))
                    delay = reset - time.time() + 1 if remaining < 12 else 0
                    if delay <= 0:
                        self.windows[bucket] = (remaining - 1 if reset > time.time() else 1000000, reset)
                        break
                time.sleep(min(delay, 5))
            headers = {"User-Agent": "ColmapView-dataset-audit/1.0", "Accept-Encoding": "identity"}
            if range_header:
                headers["Range"] = range_header
            authenticated = api and self.token and parsed.netloc == "huggingface.co" and parsed.path.startswith("/api/datasets/")
            if authenticated:
                headers["Authorization"] = "Bearer " + self.token
            request = urllib.request.Request(url, headers=headers)
            opener = urllib.request.build_opener(NoRedirect()).open if authenticated else urllib.request.urlopen
            timeout = max(0.1, min(20, deadline - time.monotonic())) if deadline else 20
            try:
                with opener(request, timeout=timeout) as response:
                    response_headers = {k.lower(): v for k, v in response.headers.items()}
                    match = re.search(r'"(api|resolvers)";r=(\d+);t=(\d+)', response_headers.get("ratelimit", ""))
                    if match:
                        with self.lock:
                            key, left, seconds = match.groups()
                            reset = time.time() + int(seconds)
                            previous = self.windows.get(key, (1000000, 0))
                            if abs(previous[1] - reset) < 10:
                                left = min(int(left), previous[0])
                            self.windows[key] = (int(left), reset)
                    data = response.read(limit + 1)
                    truncated = len(data) > limit
                    if api and truncated:
                        raise ValueError("Repository metadata exceeds the bounded response limit")
                    return data[:limit], response_headers, response.status, truncated
            except urllib.error.HTTPError as error:
                if error.code in (429, 500, 502, 503, 504) and attempt < 2:
                    retry = error.headers.get("Retry-After", "5")
                    delay = min(300, float(retry)) if retry.replace(".", "", 1).isdigit() else 5
                    if error.code == 429:
                        match = re.search(r';t=(\d+)', error.headers.get("ratelimit", ""))
                        delay = int(match.group(1)) + 1 if match else max(delay, 30)
                    if deadline and time.monotonic() + delay >= deadline:
                        raise RuntimeError(f"HTTP {error.code}; retry budget reached") from None
                    time.sleep(delay)
                    continue
                raise RuntimeError(f"HTTP {error.code}") from None
            except (TimeoutError, OSError):
                if attempt == 2:
                    raise TimeoutError("Source request timed out or failed") from None
        raise RuntimeError("Request retry budget reached")


def source_url(repo, revision, path):
    return f"{BASE}/datasets/{urllib.parse.quote(repo, safe='/')}/resolve/{revision}/{urllib.parse.quote(path, safe='/')}"


def model_sets(paths):
    directories = defaultdict(dict)
    for path in paths:
        directory, _, filename = path.rpartition("/")
        match = re.fullmatch(r"(cameras|images|points3d)\.(bin|txt)", filename, re.I)
        if match:
            role, extension = match.groups()
            old = directories[directory].get(role.lower(), "")
            if not old or extension.lower() == "bin":
                directories[directory][role.lower()] = path
    complete, camera_only = [], []
    for directory, files in directories.items():
        if "cameras" in files and "images" in files:
            (complete if "points3d" in files else camera_only).append({"directory": directory, "files": files})
    return sorted(complete, key=lambda x: (len(x["directory"]), x["directory"])), camera_only


def ply_header(raw):
    text = raw.decode("ascii", errors="replace").replace("\r\n", "\n")
    if not text.startswith("ply\n") or "\nend_header" not in text:
        raise ValueError("No complete PLY header in the bounded prefix")
    header = text.split("\nend_header", 1)[0]
    format_match = re.search(r"^format (ascii|binary_little_endian|binary_big_endian) 1\.0$", header, re.M)
    vertex = re.search(r"^element vertex (\d+)\n(.*?)(?=^element |\Z)", header, re.M | re.S)
    if not format_match or not vertex:
        raise ValueError("PLY has no supported vertex header")
    properties = set(re.findall(r"^property\s+\S+\s+(\w+)\s*$", vertex[2], re.M))
    scalar_types = {"char", "uchar", "int8", "uint8", "short", "ushort", "int16", "uint16", "int", "uint", "int32", "uint32", "float", "float32", "double", "float64"}
    if any(kind not in scalar_types for kind in re.findall(r"^property\s+(\S+)\s+\w+\s*$", vertex[2], re.M)):
        raise ValueError("PLY vertex property uses an unsupported scalar type")
    count = int(vertex[1])
    if not count:
        raise ValueError("PLY has zero vertices")
    kind = "gaussian_ply" if GAUSSIAN <= properties else "point_cloud_ply" if {"x", "y", "z"} <= properties else None
    if not kind:
        raise ValueError("PLY does not contain XYZ vertex positions")
    return {"format": kind, "vertices": count, "encoding": format_match[1]}


def colmap_header(path, raw, role):
    if path.lower().endswith(".bin"):
        if len(raw) < 8:
            raise ValueError("Truncated COLMAP binary header")
        count = struct.unpack_from("<Q", raw)[0]
        if count > 1000000000:
            raise ValueError("Implausible COLMAP record count")
        result = {"records": count}
        if not count and role in ("cameras", "images"):
            raise ValueError(f"COLMAP {role} has no records")
        if role == "cameras" and count:
            if len(raw) < 32:
                raise ValueError("Truncated first camera")
            _, model, width, height = struct.unpack_from("<iiQQ", raw, 8)
            if model not in range(len(CAMERA_MODELS)) or not width or not height:
                raise ValueError("Invalid camera model or dimensions")
            result.update(cameraModel=list(CAMERA_MODELS)[model], width=width, height=height)
        elif role == "images" and count:
            if len(raw) < 72:
                raise ValueError("Truncated first image pose")
            quaternion = struct.unpack_from("<4d", raw, 12)
            translation = struct.unpack_from("<3d", raw, 44)
            if not all(math.isfinite(v) for v in (*quaternion, *translation)) or not 0.9 < sum(v*v for v in quaternion) < 1.1:
                raise ValueError("Invalid first image pose")
        elif role == "points3d" and count:
            if len(raw) < 59 or not all(math.isfinite(v) for v in struct.unpack_from("<3d", raw, 16)):
                raise ValueError("Invalid first 3D point")
        return result
    text = raw.decode("utf-8", errors="replace")
    lines = [line.split() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    if not lines:
        if role == "points3d":
            return {"note": "No point records in sampled text prefix"}
        raise ValueError("No camera/pose record in sampled text prefix")
    fields = lines[0]
    int(fields[0])
    if role == "cameras":
        if len(fields) < 4 or fields[1] not in CAMERA_MODELS or int(fields[2]) <= 0 or int(fields[3]) <= 0:
            raise ValueError("Invalid text camera record")
        if len(fields) < 4 + CAMERA_MODELS[fields[1]]:
            raise ValueError("Incomplete text camera calibration")
        return {"cameraModel": fields[1], "width": int(fields[2]), "height": int(fields[3])}
    if role == "images":
        quaternion = [float(v) for v in fields[1:5]]
        if len(fields) < 10 or len(quaternion) != 4 or not 0.9 < sum(v*v for v in quaternion) < 1.1:
            raise ValueError("Invalid text image pose")
    elif len(fields) < 8 or not all(math.isfinite(float(v)) for v in fields[1:4]):
        raise ValueError("Invalid text point record")
    return {"firstRecordReadable": True}


class RemoteZip(io.RawIOBase):
    def __init__(self, network, url, deadline):
        self.network, self.url, self.deadline = network, url, deadline
        self.position, self.transferred, self.spans = 0, 0, []
        data, headers, status, truncated = network.fetch(url, range_header="bytes=-65536", deadline=deadline)
        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", headers.get("content-range", ""))
        if status == 206 and match and len(data) == int(match[2])-int(match[1])+1:
            start, _, self.size = map(int, match.groups())
        elif status == 200 and not truncated and headers.get("content-length", "").isdigit() and int(headers["content-length"]) == len(data):
            start, self.size = 0, len(data)
        else:
            raise ValueError("Host did not return a valid bounded ZIP range")
        self.headers = {key: headers[key] for key in ("access-control-allow-origin", "access-control-expose-headers") if key in headers}
        self.spans.append((start, data))
        self.transferred += len(data)

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if self.position < 0:
            raise ValueError("Invalid ZIP seek")
        return self.position

    def read(self, size=-1):
        size = self.size-self.position if size < 0 else min(size, self.size-self.position)
        if size <= 0:
            return b""
        for start, data in self.spans:
            if start <= self.position and self.position+size <= start+len(data):
                value = data[self.position-start:self.position-start+size]
                self.position += len(value)
                return value
        if self.transferred+size > 16*1024*1024:
            raise ValueError("ZIP metadata exceeds the 16 MiB per-archive budget")
        start = self.position
        data, headers, status, truncated = self.network.fetch(self.url, limit=size,
            range_header=f"bytes={start}-{start+size-1}", deadline=self.deadline)
        if status != 206 or headers.get("content-range") != f"bytes {start}-{start+size-1}/{self.size}" or len(data) != size or truncated:
            raise ValueError("ZIP range offset, length or total size changed")
        self.spans.append((start, data))
        self.transferred += len(data)
        self.position += len(data)
        return data


def probe_file(network, url, path, deadline, role=None):
    raw, headers, status, truncated = network.fetch(url, range_header="bytes=0-65535", deadline=deadline)
    if status == 206:
        match = re.fullmatch(r"bytes 0-(\d+)/(\d+)", headers.get("content-range", ""))
        if not match or truncated or int(match[1])+1 != len(raw) or int(match[1]) >= int(match[2]):
            raise ValueError("Incorrect prefix range offset, length or total size")
    result = {"path": path, "url": url, "httpStatus": status, "bytesRead": len(raw),
              "entireFileRead": status == 200 and not truncated,
              "corsHeader": headers.get("access-control-allow-origin", "")}
    length = re.search(r"/(\d+)$", headers.get("content-range", ""))
    result["sizeBytes"] = int(length[1]) if length else int(headers.get("content-length", "0"))
    if role:
        result.update(colmap_header(path, raw, role))
    elif path.lower().endswith(".ply"):
        result.update(ply_header(raw))
    elif path.lower().endswith(".spz"):
        if raw[:4] == b"\x28\xb5\x2f\xfd":
            result.update(format="zstd_wrapped_splat", note="Zstandard-compressed content, not a standard SPZ header; decompress and identify the payload before opening")
            return result
        header = zlib.decompressobj(16+zlib.MAX_WBITS).decompress(raw, 16) if raw[:2] == b"\x1f\x8b" else raw[:16]
        if len(header) < 16:
            raise ValueError("Truncated SPZ header")
        magic, version, count = struct.unpack_from("<III", header)
        if magic != 0x5053474e or version not in (1, 2, 3, 4) or not count:
            raise ValueError("Invalid SPZ magic/version/point count")
        result.update(format="spz_v4" if version == 4 else "spz", vertices=count, version=version)
    elif path.lower().endswith(".json"):
        if truncated:
            result.update(format="camera_metadata", note="JSON exceeds prefix budget; schema unverified")
        else:
            item = json.loads(raw)
            if not isinstance(item, dict) or not isinstance(item.get("frames"), list) or not item["frames"]:
                raise ValueError("No posed-photo frames in camera JSON")
            matrix = item["frames"][0].get("transform_matrix")
            if not isinstance(matrix, list) or len(matrix) != 4 or any(not isinstance(row, list) or len(row) != 4 for row in matrix):
                raise ValueError("No 4x4 camera transform in first frame")
            result.update(format="camera_metadata", frames=len(item["frames"]), schema="transforms frames / 4x4 matrix")
    return result


def probe_sog(network, url, deadline):
    remote = RemoteZip(network, url, deadline)
    with zipfile.ZipFile(remote) as archive:
        paths = set(archive.namelist())
        meta_path = next((path for path in paths if path.split("/")[-1] == "meta.json"), None)
        if not meta_path or archive.getinfo(meta_path).file_size > 65536:
            raise ValueError("SOG has no bounded meta.json")
        metadata = json.loads(archive.read(meta_path))
        directory = meta_path.rpartition("/")[0]
        for key in ("means", "scales", "quats", "sh0"):
            part = metadata.get(key)
            if not isinstance(part, dict) or not isinstance(part.get("files"), list) or not part["files"]:
                raise ValueError("SOG metadata is missing property images")
            if any(not isinstance(path, str) or (directory+"/"+path if directory else path) not in paths for path in part["files"]):
                raise ValueError("SOG metadata references missing property images")
        return {"url": url, "format": "sog", "sizeBytes": remote.size, "bytesRead": remote.transferred,
                "scope": "SOG metadata and referenced filenames checked; property images not decoded", "version": metadata.get("version", 1)}


def probe_zip(network, url, deadline, model_directory=None):
    remote = RemoteZip(network, url, deadline)
    with zipfile.ZipFile(remote) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()]
        paths = [entry.filename for entry in members]
        complete, cameras = model_sets(paths)
        result = {"url": url, "sizeBytes": remote.size, "members": len(paths), "completeDirectory": True,
                  "modelCount": len(complete), "cameraOnlyCount": len(cameras), "extensions": dict(Counter(Path(path).suffix.lower() for path in paths)),
                  "nestedArchives": sum(path.lower().endswith(ARCHIVES) for path in paths), "probes": [], **remote.headers}
        if complete:
            model = next((model for model in complete if model["directory"].strip("/") == model_directory.strip("/")), None) if model_directory else complete[0]
            if model is None:
                raise ValueError("The catalog's exact scene/model directory is absent from this archive")
            for role, path in model["files"].items():
                with archive.open(path) as handle:
                    raw = handle.read(65536)
                result["probes"].append({"path": path, "role": role, **colmap_header(path, raw, role)})
            result.update(format="colmap", modelDirectory=model["directory"])
        else:
            plys = sorted((path for path in paths if path.lower().endswith(".ply")), key=lambda path: (len(path), path))
            for path in plys[:2]:
                try:
                    with archive.open(path) as handle:
                        header = ply_header(handle.read(65536))
                    result["probes"].append({"path": path, **header})
                    result["format"] = header["format"]
                    break
                except (ValueError, RuntimeError, NotImplementedError, zlib.error) as error:
                    result["probes"].append({"path": path, "error": str(error)[:180]})
            splats = [path for path in paths if path.lower().endswith((".spz", ".sog"))]
            if "format" not in result and splats:
                result.update(format="splat_extension_only", note="Contained SPZ/SOG name; payload not decoded")
            elif "format" not in result and cameras:
                result["format"] = "camera_only"
            elif "format" not in result and any(CAMERA.search(path) for path in paths):
                result["format"] = "camera_metadata"
            elif "format" not in result and any(path.lower().endswith(GEOMETRY) for path in paths):
                result["format"] = "geometry_conversion"
            result["unverifiedNativeCandidates"] = bool(plys) and result.get("format") not in ("point_cloud_ply", "gaussian_ply")
        result["bytesRead"] = remote.transferred
        return result


def refresh_metadata(network, row, output):
    cache = output/"metadata"/(hashlib.sha256(row["id"].encode()).hexdigest()+".json.gz")
    if cache.exists():
        return read(cache)
    url = BASE+"/api/datasets/"+urllib.parse.quote(row["id"], safe="/")+"?"+urllib.parse.urlencode([
        ("expand[]", key) for key in ("sha", "gated", "private", "disabled", "cardData", "siblings", "lastModified", "tags")])
    result = {"id": row["id"], "checkedAt": now()}
    try:
        raw, _, _, _ = network.fetch(url, limit=32*1024*1024, api=True)
        metadata = json.loads(raw)
        if metadata.get("private"):
            result.update(availability="not_public")
        else:
            result.update(availability="public", revision=metadata.get("sha"), gated=metadata.get("gated", False), disabled=metadata.get("disabled", False),
                paths=[entry["rfilename"] for entry in metadata.get("siblings", []) if isinstance(entry.get("rfilename"), str)],
                license=(metadata.get("cardData") or {}).get("license"), lastModified=metadata.get("lastModified"))
            result["listingComplete"] = len(result["paths"]) < 100000
    except Exception as error:
        result.update(availability="unavailable", error=str(error)[:180])
    save(cache, result)
    return result


def audit_repo(network, row, metadata, output):
    cache = output/"probes"/(hashlib.sha256(row["id"].encode()).hexdigest()+".json.gz")
    if cache.exists():
        previous = read(cache)
        needs_format_recheck = previous.get("level") != "header_checked" and (any(path.lower().endswith(".sog") for path in metadata.get("paths", []))
            or "spz_v4" in previous.get("formats", [])
            or any("Invalid SPZ" in issue.get("error", "") or "4 MiB" in issue.get("error", "") for issue in previous.get("issues", [])))
        if previous.get("revision") == metadata.get("revision") and not needs_format_recheck:
            return previous
    result = {"sourceId": "hf:"+row["id"], "previousStatus": row["status"], "checkedAt": now(),
              "revision": metadata.get("revision"), "metadataAvailability": metadata["availability"], "probes": [], "issues": []}
    if metadata["availability"] != "public":
        result.update(level="unavailable", detail=metadata.get("error", "Source is no longer public"))
        save(cache, result)
        return result
    paths, revision = metadata["paths"], metadata["revision"]
    complete, cameras = model_sets(paths)
    result.update(modelCount=len(complete), cameraOnlyCount=len(cameras), fileCount=len(paths), listingComplete=metadata["listingComplete"],
                  license=metadata.get("license"), gated=metadata.get("gated", False))
    deadline = time.monotonic()+100
    plys = sorted((path for path in paths if path.lower().endswith(".ply")), key=lambda path: (0 if re.search(r"point_cloud|iteration_|gaussian|splat", path, re.I) else 1, len(path), path))
    archives = sorted((path for path in paths if path.lower().endswith(ARCHIVES)), key=lambda path: (0 if re.search(r"colmap|sparse|sfm|reconstruction|point|splat", path, re.I) else 1, len(path), path))
    result.update(archiveCount=len(archives), plyCount=len(plys), formats=[])
    candidates = []
    if complete:
        for role, path in complete[0]["files"].items():
            candidates.append((path, role))
        result["modelDirectory"] = complete[0]["directory"]
    else:
        candidates.extend((path, None) for path in plys[:3])
        candidates.extend((path, None) for path in paths if path.lower().endswith(".spz"))
        candidates = candidates[:3]
    for path, role in candidates:
        try:
            probe = probe_file(network, source_url(row["id"], revision, path), path, deadline, role)
            result["probes"].append(probe)
            if probe.get("format"):
                result["formats"].append(probe["format"])
        except Exception as error:
            result["issues"].append({"path": path, "error": str(error)[:180]})
    if not result["formats"]:
        sogs = sorted(path for path in paths if path.lower().endswith(".sog"))
        if sogs and not metadata.get("gated"):
            try:
                probe = probe_sog(network, source_url(row["id"], revision, sogs[0]), deadline)
                result["probes"].append(probe)
                result["formats"].append("sog")
            except Exception as error:
                result["issues"].append({"path": sogs[0], "error": str(error)[:180]})
    native_formats = {"colmap", "point_cloud_ply", "gaussian_ply", "spz", "sog"}
    if complete and len(result["probes"]) == 3 and not result["issues"]:
        result.update(level="header_checked", formats=["colmap"], loadUrl=f"{BASE}/datasets/{row['id']}/tree/{revision}/{urllib.parse.quote(complete[0]['directory'], safe='/')}")
    elif native_formats.intersection(result["formats"]):
        result.update(level="header_checked", loadUrl=next(probe["url"] for probe in result["probes"] if probe.get("format") in native_formats))
    elif result["formats"]:
        result["level"] = "conversion_needed"
    elif complete or plys or any(path.lower().endswith((".spz", ".sog")) for path in paths):
        result["level"] = "file_set_only"
    else:
        result["level"] = "unverified"
    if result["level"] != "header_checked" and not metadata.get("gated"):
        zips = [path for path in archives if path.lower().endswith(".zip")]
        limit = len(zips) if len(zips) <= 8 else 3
        for path in zips[:limit]:
            if time.monotonic() >= deadline:
                result["issues"].append({"error": "Per-source archive time budget reached"})
                break
            try:
                probe = probe_zip(network, source_url(row["id"], revision, path), deadline)
                result["probes"].append(probe)
                if probe.get("format") in ("colmap", "point_cloud_ply", "gaussian_ply"):
                    result.update(level="header_checked", formats=[probe["format"]], loadUrl=probe["url"])
                    break
                if probe.get("format"):
                    result["formats"].append(probe["format"])
            except Exception as error:
                result["issues"].append({"path": path, "error": str(error)[:180]})
        result["allArchivesInspected"] = bool(archives) and len(result["probes"]) == len(archives) and not result["issues"] and all(probe.get("completeDirectory") and not probe.get("nestedArchives") for probe in result["probes"])
    if result["level"] not in ("header_checked", "file_set_only"):
        camera_paths = [path for path in paths if CAMERA.search(path)]
        if result["formats"] and any(format in ("zstd_wrapped_splat", "spz_v4") for format in result["formats"]):
            result["level"] = "conversion_needed"
        elif cameras:
            result.update(level="camera_only", formats=["camera_only"])
        elif camera_paths or "camera_metadata" in result["formats"]:
            result.update(level="conversion_needed", formats=["camera_metadata"], metadataPath=camera_paths[0] if camera_paths else None)
        elif any(path.lower().endswith(GEOMETRY) for path in paths):
            result.update(level="conversion_needed", formats=sorted(set(Path(path).suffix.lower() for path in paths if path.lower().endswith(GEOMETRY))))
        elif not archives and not result["issues"] and not any(path.lower().endswith((".parquet", ".arrow", ".npz", ".npy", ".pt", ".pth", ".pkl", ".bin", ".json", ".h5", ".hdf5")) for path in paths) and metadata["listingComplete"]:
            result.update(level="no_native_assets", detail="Complete recorded listing contains no native 3D or posed-camera assets")
        elif result.get("allArchivesInspected") and not result["formats"] and metadata["listingComplete"] and not any(probe.get("unverifiedNativeCandidates") for probe in result["probes"]):
            result.update(level="no_native_assets", detail="All listed archives inspected; no native COLMAP, XYZ PLY, SPZ/SOG or recognized camera dataset found")
    result["formats"] = sorted(set(result["formats"]))
    if metadata.get("gated"):
        result["delivery"] = "gated"
    elif result["level"] == "header_checked":
        result["delivery"] = "server_readable"
    elif result["issues"]:
        errors = " ".join(issue["error"] for issue in result["issues"])
        result["delivery"] = "access_denied" if re.search(r"HTTP (401|403)", errors) else "not_found" if "HTTP 404" in errors else "unverified"
    else:
        result["delivery"] = "not_tested"
    save(cache, result)
    return result


def audit_public(network, entry, output):
    cache = output/"public"/(hashlib.sha256(entry["sourceId"].encode()).hexdigest()+".json.gz")
    if cache.exists():
        return read(cache)
    url = entry.get("dataUrl", entry["sourceUrl"])
    if entry.get("modelManifest"):
        url = next((fact["value"] for fact in entry["facts"] if fact["label"] == "Original dataset URL"), entry["modelManifest"]["baseUrl"])
    path = urllib.parse.unquote(urllib.parse.urlsplit(url).path).removesuffix("/content")
    model = next((fact["value"] for fact in entry["facts"] if fact["label"] == "COLMAP model directory"), None)
    result = {"sourceId": entry["sourceId"], "checkedAt": now(), "previousStatus": entry["status"], "url": url,
              "formats": [], "issues": [], "probes": []}
    deadline = time.monotonic()+100
    try:
        if path.lower().endswith(".zip"):
            probe = probe_zip(network, url, deadline, model)
            result["probes"].append(probe)
            if probe.get("format") in ("colmap", "point_cloud_ply", "gaussian_ply"):
                result.update(level="header_checked", formats=[probe["format"]], loadUrl=url)
            elif probe.get("format"):
                result.update(level="conversion_needed", formats=[probe["format"]])
            else:
                result.update(level="unverified", detail="Archive directory readable; no supported model/header established")
        elif path.endswith("/"):
            for role, filename in (("cameras", "cameras.bin"), ("images", "images.bin"), ("points3d", "points3D.bin")):
                file_url = urllib.parse.urljoin(url, filename)
                result["probes"].append(probe_file(network, file_url, filename, deadline, role))
            result.update(level="header_checked", formats=["colmap"], loadUrl=url)
        else:
            probe = probe_file(network, url, path, deadline)
            result["probes"].append(probe)
            result.update(level="conversion_needed" if probe.get("format") == "camera_metadata" else "unverified", formats=[probe["format"]] if probe.get("format") else [])
        result["delivery"] = "server_readable"
    except Exception as error:
        result.update(level="unverified", delivery="access_denied" if re.search(r"HTTP (401|403)", str(error)) else "not_found" if "HTTP 404" in str(error) else "unverified")
        result["issues"].append({"error": str(error)[:180]})
    save(cache, result)
    return result


def existing_token():
    paths = [Path.home()/".cache/huggingface/token"]
    if os.environ.get("HF_TOKEN_PATH"):
        paths.insert(0, Path(os.environ["HF_TOKEN_PATH"]))
    if os.environ.get("HF_HOME"):
        paths.insert(0, Path(os.environ["HF_HOME"])/"token")
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or next((path.read_text().strip() for path in paths if path.is_file()), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory")
    parser.add_argument("--catalog", default="data/catalog.json")
    parser.add_argument("--out", required=True)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--phase", choices=("metadata", "probe", "public"), default="metadata")
    parser.add_argument("--use-existing-hf-auth", action="store_true")
    parser.add_argument("--cached-only", action="store_true", help="Probe only already refreshed public metadata; rerun without this flag for full coverage")
    args = parser.parse_args()
    output = Path(args.out)
    if args.phase != "public" and not args.inventory:
        parser.error("--inventory is required for Hugging Face phases")
    if args.phase == "public":
        rows = [entry for entry in read(Path(args.catalog))["entries"] if entry["provider"] == "public"]
    else:
        inventory = read(Path(args.inventory))
        rows = inventory.get("datasets")
        if rows is None:
            rows = [{"id": entry["sourceId"][3:], "status": entry.get("previousStatus", entry["level"]),
                     "ready_format": entry["level"] == "header_checked"}
                    for entry in inventory["results"] if entry["sourceId"].startswith("hf:")]
    if args.cached_only:
        rows = [row for row in rows if (output/"metadata"/(hashlib.sha256(row["id"].encode()).hexdigest()+".json.gz")).exists()]
    # Establish the strongest previous claims first, but revisit every candidate.
    rows.sort(key=lambda row: (0 if row.get("ready_format") else 1, row["id"].lower()))
    network = Network(existing_token() if args.use_existing_hf_auth else None)
    print(json.dumps({"phase": args.phase, "datasets": len(rows), "existingMetadataAuth": bool(network.token)}), flush=True)
    results = []
    def task(row):
        if args.phase == "public":
            return audit_public(network, row, output)
        metadata = refresh_metadata(network, row, output)
        return metadata if args.phase == "metadata" else audit_repo(network, row, metadata, output)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(task, row): row for row in rows}
        for future in concurrent.futures.as_completed(futures):
            row = futures[future]
            try:
                results.append(future.result())
            except Exception as error:
                results.append({"sourceId": "hf:"+row["id"], "level": "audit_error", "error": str(error)[:180]})
            if len(results) % 50 == 0 or len(results) == len(rows):
                counts = dict(Counter(item.get("level", item.get("availability", "error")) for item in results))
                progress = {"phase": args.phase, "completed": len(results), "total": len(rows), "counts": counts, "updatedAt": now()}
                save(output/(args.phase+"-progress.json"), progress)
                print(json.dumps(progress), flush=True)
    if args.phase in ("probe", "public"):
        save(output/("public-audit.json" if args.phase == "public" else "hf-audit.json"), {"schemaVersion": 1, "checkedAt": now(), "scope": "Representative format headers and bounded archive metadata; not complete scene render certification", "results": sorted(results, key=lambda item: item["sourceId"])})


if __name__ == "__main__":
    main()
