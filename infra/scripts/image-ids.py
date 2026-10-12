#!/usr/bin/env python3
import json
import subprocess
import sys

images = sys.argv[1:]
for image in images:
    raw = subprocess.check_output(["docker", "image", "inspect", image], text=True)
    print(image, json.loads(raw)[0]["Id"])
