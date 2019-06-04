runtime   := nodejs10.x
name      := $(shell node -p "require('./package.json').name")
version   := $(shell node -p "require('./package.json').version")
build     := $(shell git describe --tags --always)
buildfile := .docker/$(build)
distfile  := $(name)-$(version).tgz
digest     = $(shell cat $(buildfile))

$(distfile): | package-lock.json
	docker run --rm $(digest) cat $@ > $@

package-lock.json: $(buildfile)
	docker run --rm $(digest) cat $@ > $@

$(buildfile): | .docker
	docker build \
	--build-arg RUNTIME=$(runtime) \
	--iidfile $@ \
	--tag $(name):$(build) .

.docker:
	mkdir -p $@

.PHONY: clean

clean:
	docker image rm -f $(name) $(shell sed G .docker/*)
	rm -rf .docker *.tgz package-lock.json
