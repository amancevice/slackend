runtime   := nodejs10.x
name      := $(shell node -p "require('./package.json').name")
version   := $(shell node -p "require('./package.json').version")
build     := $(shell git describe --tags --always)
digest     = $(shell cat .docker/$(build))

.PHONY: all clean

all: package-lock.json $(name)-$(version).tgz

.docker:
	mkdir -p $@

.docker/$(build): | .docker
	docker build \
	--build-arg RUNTIME=$(runtime) \
	--iidfile $@ \
	--tag $(name):$(build) .

package-lock.json $(name)-$(version).tgz: .docker/$(build)
	docker run --rm -w /var/task $(digest) cat $@ > $@

clean:
	-docker image rm -f $(name) $(shell awk {print} .docker/*)
	-rm -rf .docker *.tgz package-lock.json
