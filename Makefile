.PHONY: client
client: build/data build/assets build/app.js build/app.css build/index.html

build/.build/from_typescript.js: ./app.ts ./scripts/*.ts ./typings/*/*.d.ts
	./node_modules/tsc/bin/tsc --target ES5 --sourceMap --out build/.build/from_typescript.js ./app.ts ./scripts/*.ts ./typings/*/*.d.ts 

build/.build/with_vendors.js: build/.build/from_typescript.js ./vendor/*.js
	cat ./vendor/*.js build/.build/from_typescript.js >  build/.build/with_vendors.js

build/app.js: build/.build/with_vendors.js
	./node_modules/uglify-js/bin/uglifyjs build/.build/with_vendors.js > build/app.js

build/index.html: ./index.html
	./node_modules/html-minifier/cli.js ./index.html > build/index.html

build/app.css: ./styles/app.css ./vendor/*.css
	./node_modules/clean-css/bin/cleancss ./vendor/*.css ./styles/app.css > build/app.css

build/data: data/*.json
	mkdir -p build/.build
	rsync -rup data build

build/assets: assets
	mkdir -p build/.build
	rsync -rupE assets build
