"""
Script: extract all Berlin restaurants with real meal data
and write them to frontend/src/data/mockData.js in Nutrition App 2.0
"""

import json
import math
import re
import datetime
import os
import base64
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

MAX_MEALS_PER_RESTAURANT = None  # no limit — show all unique meals per restaurant

PRICE_LEVEL_MAP = {1: "€", 2: "€€", 3: "€€€", 4: "€€€€"}

# Strip leading menu-order numbers like "11. Name" or "58.Name" — keep quantity
# numbers like "6 Chicken Wings" (no dot) and years like "2022 Sauvignon Blanc"
_MENU_NUM_RE = re.compile(r'^\d+\.\s*')


def get_today_hours(opening_hours):
    """Return (is_open, hours_string) using periods data."""
    if not opening_hours:
        return None, None

    now = datetime.datetime.now()
    # Google API: day 0=Sunday, 1=Monday ... 6=Saturday
    # Python: weekday() 0=Monday ... 6=Sunday
    py_day = now.weekday()
    google_day = (py_day + 1) % 7
    current_time = int(now.strftime("%H%M"))

    weekday_text = opening_hours.get("weekday_text", [])
    # weekday_text is Mon-Sun order (index 0=Monday)
    if weekday_text and len(weekday_text) >= 7:
        hours_str = weekday_text[py_day]
        # Strip day name prefix, e.g. "Montag: 12:00–22:00 Uhr" → "12:00–22:00"
        if ": " in hours_str:
            hours_str = hours_str.split(": ", 1)[1].replace(" Uhr", "")
    else:
        hours_str = None

    # Calculate is_open from periods
    periods = opening_hours.get("periods", [])
    is_open = False
    for period in periods:
        o = period.get("open", {})
        c = period.get("close", {})
        if o.get("day") == google_day:
            open_t = int(o.get("time", "0000"))
            close_day = c.get("day", google_day)
            close_t = int(c.get("time", "2359"))
            if close_day == google_day:
                # Same day close
                if open_t <= current_time < close_t:
                    is_open = True
            else:
                # Closes next day (past midnight)
                if current_time >= open_t:
                    is_open = True
        elif c.get("day") == google_day:
            # Period that opened yesterday, closes today
            close_t = int(c.get("time", "0000"))
            if current_time < close_t:
                is_open = True

    return is_open, hours_str


def confidence_rank(c):
    return {"high": 0, "medium": 1, "low": 2}.get(c, 3)


def fetch_photo_b64(url, size=80):
    """Download image, resize to size×size, return base64 data URI. Returns None on failure."""
    try:
        from PIL import Image as PILImage
        import io
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
        img = PILImage.open(io.BytesIO(raw)).convert('RGB')
        # Crop to square from center, then resize
        w, h = img.size
        s = min(w, h)
        img = img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
        img = img.resize((size, size), PILImage.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=75, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode('ascii')
        return f"data:image/jpeg;base64,{b64}"
    except ImportError:
        # PIL not available — skip pin photos
        return None
    except Exception as e:
        print(f"  [warn] photo download failed for {url[:60]}: {e}")
        return None


def download_pin_photos(candidates, workers=10):
    """Download all pin photos in parallel. Returns dict: name → b64."""
    tasks = {}
    for r, meals in candidates:
        first_url = meals[0].get("image_url") if meals else None
        if first_url:
            tasks[r["name"]] = first_url

    results = {}
    print(f"Downloading {len(tasks)} pin photos (parallel, {workers} workers) …")
    with ThreadPoolExecutor(max_workers=workers) as ex:
        future_to_name = {ex.submit(fetch_photo_b64, url): name for name, url in tasks.items()}
        done = 0
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            results[name] = future.result()
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(tasks)} downloaded …")
    print(f"  Done. {sum(1 for v in results.values() if v)} succeeded, "
          f"{sum(1 for v in results.values() if not v)} failed.")
    return results


def main():
    print("Loading all_restaurants.json …")
    with open("data/all_restaurants.json", encoding="utf-8") as f:
        data = json.load(f)

    print(f"Total restaurants in dataset: {len(data)}")

    # Filter: require lat/lon + meals with photos + calories
    candidates = []
    for r in data:
        lat, lon = r.get("lat"), r.get("lon")
        if not lat or not lon:
            continue
        raw = [
            m for m in (r.get("wolt_menu") or [])
            if m.get("calories") and m.get("image_url")
        ]
        if not raw:
            continue
        # Deduplicate by meal name — Wolt sometimes lists the same item in multiple categories
        seen_names = set()
        meals = []
        for m in raw:
            if m["name"] not in seen_names:
                seen_names.add(m["name"])
                meals.append(m)
        candidates.append((r, meals))

    print(f"Restaurants with meal photos + calories: {len(candidates)}")

    # Sort: restaurants with photo_url first, then by reviews_count desc
    candidates.sort(key=lambda x: (
        0 if x[0].get("photo_url") else 1,
        -(x[0].get("reviews_count") or 0)
    ))
    print(f"Selected: {len(candidates)} restaurants (all of them)")

    # Download all pin photos in parallel
    pin_photos = download_pin_photos(candidates, workers=10)

    restaurants_js = []
    meals_js = []
    meal_id = 0

    for r, raw_meals in candidates:
        r_id = r.get("place_id") or r.get("google_place_id") or r["name"]
        # Sanitise ID for use in JS
        r_id_safe = r_id.replace("/", "_").replace(" ", "_")

        # Compute real price range from meal prices (min–max)
        meal_prices = sorted(set(
            m["price"] for m in raw_meals if m.get("price") and 3 <= m["price"] <= 50
        ))
        if len(meal_prices) >= 2:
            price_range = f"€{meal_prices[0]:.0f}–{meal_prices[-1]:.0f}"
        elif len(meal_prices) == 1:
            price_range = f"€{meal_prices[0]:.0f}"
        else:
            price_level = r.get("price_level")
            price_range = PRICE_LEVEL_MAP.get(price_level, "")

        is_open, hours_str = get_today_hours(r.get("opening_hours"))

        pin_photo_b64 = pin_photos.get(r["name"])

        rest_obj = {
            "id": r_id_safe,
            "name": r["name"],
            "photo": (r.get("photo_url") or "").split("&key=")[0],  # key added at runtime via withKey()
            "pinPhoto": pin_photo_b64,  # base64 data URI for canvas pin icon
            "rating": r.get("rating"),
            "reviewCount": r.get("reviews_count"),
            "address": r.get("address", ""),
            "priceRange": price_range,
            "isOpen": is_open,
            "hours": hours_str,
            "distance": None,   # not computed — all of Berlin, GPS-based distance can be added later
            "lat": r["lat"],
            "lng": r["lon"],
            "woltSlug": r.get("wolt_slug") or None,
        }
        restaurants_js.append(rest_obj)

        # Sort meals: high confidence first, then by calories desc
        sorted_meals = sorted(raw_meals, key=lambda m: (
            confidence_rank(m.get("confidence")),
            -(m.get("calories") or 0)
        ))

        for m in sorted_meals:
            price_val = m.get("price")
            price_str = f"€{price_val:.2f}" if price_val else None

            meal_obj = {
                "id": meal_id,
                "name": _MENU_NUM_RE.sub("", m["name"]),
                "photo": m["image_url"],
                "price": price_str,
                "description": m.get("description") or "",
                "calories": m.get("calories"),
                "protein": m.get("protein"),
                "fat": m.get("fat"),
                "carbs": m.get("carbs"),
                # Denormalised restaurant fields for CardMeal
                "restaurantId": r_id_safe,
                "restaurantName": r["name"],
                "restaurantPhoto": (r.get("photo_url") or "").split("&key=")[0],  # key added at runtime
                "rating": r.get("rating"),
                "reviewCount": r.get("reviews_count"),
                "priceRange": price_range,
                "distance": None,
                "restaurantAddress": r.get("address", ""),
            }
            meals_js.append(meal_obj)
            meal_id += 1

    # Write JS file
    out_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "../frontend/src/data/mockData.js"
    )
    out_path = os.path.normpath(out_path)

    restaurants_json = json.dumps(restaurants_js, indent=2, ensure_ascii=False)
    meals_json = json.dumps(meals_js, indent=2, ensure_ascii=False)

    js_content = f"""// Auto-generated by extract_frontend_data.py — do not edit by hand
// {len(restaurants_js)} restaurants, {len(meals_js)} meals — Berlin

export const MOCK_RESTAURANTS = {restaurants_json};

export const MOCK_MEALS = {meals_json};
"""

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(js_content)

    print(f"\nWritten: {out_path}")
    print(f"Total restaurants: {len(restaurants_js)}, total meals: {len(meals_js)}")


if __name__ == "__main__":
    main()
