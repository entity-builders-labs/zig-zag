.DEFAULT_GOAL := help

AWS_REGION ?= us-east-1
AWS_PROJECT_TAG ?= zig-zag
AWS_RDS_ID ?= zig-zag-postgres
# Local commands use the project-specific profile instead of whichever account
# happens to be configured as default. GitHub Actions uses OIDC credentials and
# sets CI=true, so it must not receive a named local profile.
AWS_PROFILE ?= $(if $(CI),,zig-zag)
AWS_PROFILE_ENV := $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE))
AWS_POWER_ENV := $(AWS_PROFILE_ENV) AWS_REGION=$(AWS_REGION) AWS_PROJECT_TAG=$(AWS_PROJECT_TAG) AWS_RDS_ID=$(AWS_RDS_ID)

.PHONY: help aws-start aws-stop aws-status aws-seed-secrets check-gh rollback_deploy finish_deploy dev-start dev-stop dev-build fe-web fe-web-e2e test-unit test-e2e test-e2e-headed test-e2e-watch metro android-prebuild android-build android-emu android-device ios-sim ios-device ios-device-install

help: ## List the available targets
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## --- AWS production (stopped by default to save cost) ---
## Stopping preserves RDS and EBS data. AWS auto-restarts a stopped RDS
## instance after 7 days — there's no automatic shutdown, so check
## aws-status once in a while if the environment isn't used often.

aws-start: ## Start RDS, then the backend
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh start

aws-stop: ## Stop the backend and RDS without deleting their data
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh stop

aws-status: ## Show the state and type of the EC2 instances and RDS
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh status

aws-seed-secrets: ## Copy secrets from .env into SSM SecureString params without printing them
	@AWS_REGION=$(AWS_REGION) node scripts/aws-seed-parameters.mjs .env

## --- Backend canary control (blue/green) ---
## These run via GitHub Actions (workflow_dispatch) instead of local AWS
## credentials, so they don't depend on having the AWS profile set up
## locally — only on being logged in with `gh`.

check-gh: ## Verify gh is installed and logged in, fix it if not
	@command -v gh >/dev/null 2>&1 || { \
		echo "gh is not installed, installing via Homebrew..."; \
		command -v brew >/dev/null 2>&1 || { echo "Install Homebrew first: https://brew.sh" >&2; exit 1; }; \
		brew install gh; \
	}
	@gh auth status >/dev/null 2>&1 || { \
		echo "gh is not authenticated, starting login..."; \
		gh auth login; \
	}

rollback_deploy: check-gh ## Flip the backend back to the previous slot (instant rollback)
	@gh workflow run backend-canary-control.yml -f action=rollback
	@echo "Triggered. Follow it with: gh run watch, or https://github.com/jiseruk/zig-zag/actions"

finish_deploy: check-gh ## Confirm the active deploy and scale down the standby slot (stop paying for 2 instances)
	@gh workflow run backend-canary-control.yml -f action=finish
	@echo "Triggered. Follow it with: gh run watch, or https://github.com/jiseruk/zig-zag/actions"

## --- Local development ---
## postgres+backend run in Docker (dev profile). The web frontend runs
## separately, and there are two different ways to serve it depending on
## what you're doing:
##   - `fe-web` is Expo's live dev server (Metro's web bundler) on :19006 —
##     use this to interactively poke around in a browser. On Expo SDK 54
##     `expo start --web` defaults to :8081 instead, so this pins the port
##     explicitly — :19006 is also what's registered as an authorized
##     origin for Google Sign-In in Google Cloud Console.
##   - `fe-web-e2e` builds a static export and serves it on :19006 with a
##     plain HTTP server instead — this is what ci.yml actually does, and
##     what fe/e2e/playwright.config.ts's default E2E_WEB_URL expects.
##     Use this (not fe-web) before running any test-e2e* target — the two
##     can't run at once since they'd fight over the same port.

dev-start: ## Start postgres + backend in Docker (dev profile)
	@docker-compose --profile dev up -d postgres backend

dev-stop: ## Stop whatever docker-compose has running
	@docker-compose down

dev-build: ## Rebuild the Docker images (postgres/backend/frontend)
	@docker-compose --profile dev build

fe-web: ## Run the frontend's live dev server on :19006 for interactive use
	@cd fe && npx expo start --web --port 19006

fe-web-e2e: ## Build the frontend and serve it statically on :19006, matching what the e2e suite expects
	@cd fe && yarn build:web
	@cd fe && python3 -m http.server 19006 --directory dist

test-unit: ## Run the backend's unit tests (fe/ has no unit test runner configured)
	@cd be && yarn test

test-e2e: ## Run the Playwright e2e suite headless (needs dev-start + fe-web-e2e running separately)
	@cd fe && yarn test:e2e

test-e2e-headed: ## Same as test-e2e but with a visible browser
	@cd fe && yarn test:e2e --headed

test-e2e-watch: ## Same as test-e2e-headed but slowed down (E2E_SLOWMO) so you can actually watch each step
	@cd fe && E2E_SLOWMO=1 yarn test:e2e --headed

## --- Mobile development (iOS & Android) ---
ANDROID_EMULATOR ?= Pixel7_API34
# Keep physical-device identifiers local instead of committing a machine/user
# specific value. Example: make ios-device IOS_PHYSICAL_DEVICE=<device-id>
IOS_PHYSICAL_DEVICE ?=
IOS_BUNDLE_ID ?= com.javieriseruk.zigzag
JAVA_HOME ?= /opt/homebrew/opt/openjdk@17
ANDROID_HOME ?= $(HOME)/Library/Android/sdk

metro: ## Start Metro bundler with host LAN for iOS and Android
	@cd fe && npx expo start --dev-client --host lan

android-prebuild: ## Generate or update native Android project from Expo config
	@export JAVA_HOME=$(JAVA_HOME) ANDROID_HOME=$(ANDROID_HOME) && cd fe && npx expo prebuild -p android --no-install
	@if [ -f fe/android/build.gradle ] && ! grep -q 'compileSdkVersion = 35' fe/android/build.gradle; then \
		sed -i '' 's/minSdkVersion = Integer.parseInt(findProperty("android.minSdkVersion") ?: "24")/buildToolsVersion = "35.0.0"\
        compileSdkVersion = 35\
        targetSdkVersion = 35\
        minSdkVersion = Integer.parseInt(findProperty("android.minSdkVersion") ?: "24")/' fe/android/build.gradle; \
	fi

android-build: ## Build Android Debug APK with Gradle
	@export JAVA_HOME=$(JAVA_HOME) ANDROID_HOME=$(ANDROID_HOME) && cd fe/android && ./gradlew assembleDebug

android-emu: ## Run and install on Android Emulator (override ANDROID_EMULATOR if needed)
	@export JAVA_HOME=$(JAVA_HOME) ANDROID_HOME=$(ANDROID_HOME) && cd fe && npx expo run:android -d $(ANDROID_EMULATOR) --no-bundler

android-device: ## Prepare port forwarding and install on connected physical Android device
	@export JAVA_HOME=$(JAVA_HOME) ANDROID_HOME=$(ANDROID_HOME) && adb reverse tcp:8081 tcp:8081 && adb reverse tcp:4000 tcp:4000 && cd fe && npx expo run:android --no-bundler

ios-sim: ## Run and install on iOS Simulator
	@cd fe && npx expo run:ios --no-bundler

ios-device: ## Build/run on a physical iPhone; requires IOS_PHYSICAL_DEVICE
	@if [ -z "$(IOS_PHYSICAL_DEVICE)" ]; then \
		echo "IOS_PHYSICAL_DEVICE is required. Example: make ios-device IOS_PHYSICAL_DEVICE=<device-id>" >&2; \
		exit 2; \
	fi
	@cd fe && npx expo run:ios -d "$(IOS_PHYSICAL_DEVICE)" --no-bundler

ios-device-install: ## Explicitly install the newest existing Debug-iphoneos app via devicectl
	@if [ -z "$(IOS_PHYSICAL_DEVICE)" ]; then \
		echo "IOS_PHYSICAL_DEVICE is required. Example: make ios-device-install IOS_PHYSICAL_DEVICE=<device-id>" >&2; \
		exit 2; \
	fi
	@APP_PATH=$$(find $(HOME)/Library/Developer/Xcode/DerivedData -name "zigzag.app" -path "*/Debug-iphoneos/*" -print0 2>/dev/null | xargs -0 ls -td 2>/dev/null | head -n 1); \
	if [ -z "$$APP_PATH" ]; then \
		echo "No Debug-iphoneos zigzag.app found in DerivedData; build first with make ios-device." >&2; \
		exit 1; \
	fi; \
	echo "Installing newest existing build: $$APP_PATH"; \
	xcrun devicectl device install app --device "$(IOS_PHYSICAL_DEVICE)" "$$APP_PATH" && \
	xcrun devicectl device process launch --device "$(IOS_PHYSICAL_DEVICE)" "$(IOS_BUNDLE_ID)"

