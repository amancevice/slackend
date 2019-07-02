stages    := build test
name      := $(shell node -p "require('./package.json').name")
version   := $(shell node -p "require('./package.json').version")
build     := $(shell git describe --tags --always)
runtime   := $(shell echo "$${RUNTIME:-nodejs10.x}")
shells    := $(foreach stage,$(stages),shell@$(stage))
iidfile   := .docker/$(build)-$(runtime)
digest     = $(shell cat $(iidfile)$(1))

.PHONY: all clean up $(stages) $(shells)

all: package-lock.json $(name)-$(version).tgz

.docker:
	mkdir -p $@

$(iidfile)@test: $(iidfile)@build
$(iidfile)@%: | .docker
	docker build \
	--build-arg RUNTIME=$(runtime) \
	--iidfile $@ \
	--tag $(name):$(build)-$* \
	--target $* .

package-lock.json $(name)-$(version).tgz: build
	docker run --rm $(call digest,@$<) cat $@ > $@

clean:
	-docker image rm -f $(shell awk {print} .docker/*)
	-rm -rf .docker *.tgz

up: build .env
	docker run --rm \
	--publish 3000:3000 \
	$(call digest,@$<) \
	npm start


$(stages): %: $(iidfile)@%

$(shells): shell@%: % .env
	docker run --rm -it $(call digest,@$*) /bin/bash
