full: VARIANT=full
full: manifest_full all_browsers

lite: VARIANT=lite
lite: manifest_lite all_browsers

dev_full: VARIANT=full
dev_full: manifest_full
	rm -rf dist_dev
	npm run dev

dev_lite: VARIANT=lite
dev_lite: manifest_lite
	rm -rf dist_dev
	npm run dev

manifest_full:
	cp manifest.pre-build.json manifest.build.json

manifest_lite:
	cp manifest.pre-build.json manifest.build.json
	jq 'del(.chrome_url_overrides)' manifest.build.json | sponge manifest.build.json
	jq '.name="Domovik Lite"' manifest.build.json | sponge manifest.build.json

all_browsers: ffox chrome edge

build build_edge:
	rm -rf dist
	npm run prod

ffox: build
	rm -f domovik-ffox-${VARIANT}.zip
	cd dist && zip -r -FS ../domovik-ffox-${VARIANT}.zip *

chrome: build
	rm -f domovik-chrome-${VARIANT}.zip
	zip -r domovik-chrome-${VARIANT}.zip dist

edge: build_edge
	rm -f domovik-edge-${VARIANT}.zip
	jq '. + {"update_URL": "https://edge.microsoft.com/extensionwebstorebase/v1/crx"}' dist/manifest.json | sponge dist/manifest.json
	cd dist && zip -r -FS ../domovik-edge-${VARIANT}.zip *

clean:
	rm -f domovik-ffox-${VARIANT}.zip
	rm -f domovik-edge-${VARIANT}.zip
	rm -f domovik-chrome-${VARIANT}.zip
