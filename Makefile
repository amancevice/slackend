stages    := build test
name      := $(shell node -p "require('./package.json').name")
version   := $(shell node -p "require('./package.json').version")
build     := $(shell git describe --tags --always)
runtime   := $(shell echo "$${RUNTIME:-nodejs10.x}")
iidfile   := .docker/$(build)-$(runtime)
digest     = $(shell cat $(iidfile)$(1))

.PHONY: all clean test $(foreach stage,$(stages),shell@$(stage))

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

package-lock.json $(name)-$(version).tgz: $(iidfile)@build
	docker run --rm -w /var/task/ $(call digest,@build) cat $@ > $@

clean:
	-docker image rm -f $(shell awk {print} .docker/*)
	-rm -rf .docker *.tgz

shell@%: $(iidfile)@%
	docker run --rm -it $(call digest,@$*) /bin/bash

test: all $(iidfile)@test
