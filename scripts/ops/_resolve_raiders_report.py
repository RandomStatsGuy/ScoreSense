import re
import requests

for handle in ["RaidersReport", "raidersreport"]:
    url = f"https://www.youtube.com/@{handle}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    m = re.search(r'canonical" href="https://www\.youtube\.com/channel/(UC[^"]+)"', r.text)
    print(handle, r.status_code, m.group(1) if m else None)
