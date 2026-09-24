"""Experimental Companion Now Playing probe.

This helper deliberately uses only pyatv's public connect API first. It prints
all Playing fields that pyatv exposes, including fields not shown by the
atvremote CLI formatter. It never prints credentials.
"""
import argparse
import asyncio
import dataclasses
import json
import pyatv


def safe_value(value):
    if dataclasses.is_dataclass(value):
        return {f.name: safe_value(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [safe_value(v) for v in value]
    if isinstance(value, dict):
        return {str(k): safe_value(v) for k, v in value.items()}
    return str(value)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--id", default="")
    ap.add_argument("--credentials", required=True)
    args = ap.parse_args()

    loop = asyncio.get_running_loop()
    configs = await pyatv.scan(loop, hosts=[args.host])
    if args.id:
        configs = [c for c in configs if args.id in c.all_identifiers]
    if not configs:
        raise SystemExit("Apple TV not found")

    config = configs[0]
    service = config.get_service(pyatv.const.Protocol.Companion)
    if service is None:
        raise SystemExit("Companion service not found")
    service.credentials = args.credentials

    atv = await pyatv.connect(config, loop)
    try:
        playing = await atv.metadata.playing()
        fields = {}
        for name in (
            "media_type", "device_state", "title", "artist", "album",
            "genre", "total_time", "position", "shuffle", "repeat",
            "series_name", "season_number", "episode_number",
            "content_identifier", "iTunes_store_identifier"
        ):
            if hasattr(playing, name):
                fields[name] = safe_value(getattr(playing, name))
        print(json.dumps(fields, ensure_ascii=False, indent=2, default=str))
    finally:
        atv.close()


if __name__ == "__main__":
    asyncio.run(main())
