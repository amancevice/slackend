.PHONY: all clean

all: node_modules

clean:
	rm -rf package-lock.json

node_modules: package-lock.json

package-lock.json: package.json
	npm install
