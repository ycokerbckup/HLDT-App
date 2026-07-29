"""
Reads the feed_sources table (admin-managed list of YouTube channel IDs),
fetches each channel's public RSS feed (no API key needed), and inserts any
new videos into feed_posts. Existing videos are skipped via the unique
(source, external_id) constraint + ignore-duplicates.
"""
import json
import os
import urllib.request
import xml.etree.ElementTree as ET

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SERVICE_ROLE_KEY"]

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "yt": "http://www.youtube.com/xml/schemas/2015",
}


def api_get(path):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode()
        return json.loads(body) if body else []


def api_insert_ignore_duplicates(path, payload):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates",
        },
        data=json.dumps(payload).encode(),
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
    except urllib.error.HTTPError as e:
        print(f"  insert failed: {e.code} {e.read().decode()[:200]}")


def main():
    sources = api_get("/rest/v1/feed_sources?select=channel_id,channel_name")
    if not sources:
        print("No feed sources configured.")
        return

    for src in sources:
        cid = src["channel_id"]
        name = src.get("channel_name") or cid
        print(f"Fetching {name} ({cid})")
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                xml_bytes = r.read()
            root = ET.fromstring(xml_bytes)
        except Exception as e:
            print(f"  failed to fetch/parse feed: {e}")
            continue

        entries = root.findall("atom:entry", NS)
        for entry in entries[:15]:
            vid_el = entry.find("yt:videoId", NS)
            title_el = entry.find("atom:title", NS)
            if vid_el is None or title_el is None:
                continue
            vid = vid_el.text
            title = title_el.text
            thumb_el = entry.find("media:group/media:thumbnail", NS)
            thumb = thumb_el.get("url") if thumb_el is not None else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
            payload = {
                "source": "youtube_auto",
                "external_id": vid,
                "title": title,
                "url": f"https://www.youtube.com/watch?v={vid}",
                "thumbnail_url": thumb,
                "description": name,
            }
            api_insert_ignore_duplicates("/rest/v1/feed_posts?on_conflict=source,external_id", payload)

    print("Done.")


if __name__ == "__main__":
    main()
