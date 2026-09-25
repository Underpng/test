setup:
	npm ci

dev:
	npm run dev

build:
	npm run build

typecheck:
	npm run typecheck

test:
	npm test

license:
	npx license-checker-rseidelsohn --json \
		| jq 'to_entries | map({key: .key, value: (.value | del(.path, .licenseFile))}) | from_entries' \
		> LICENSE.json
