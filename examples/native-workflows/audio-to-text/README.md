# Test audio-to-text workflows

Flowstride supplies prerecorded audio to the browser's microphone, drives recording controls and checks the transcript displayed by your application. Your application's speech-to-text service performs recognition.

| Requirement | Value |
| --- | --- |
| Engine | OS or Cloud |
| Browser | Chromium for audio-file microphone injection |
| Local demo | Included PCM WAV, real microphone capture and a simulated transcript response |
| Real transcription | Your own authorized recording application, service and spoken WAV fixture |

Complete the [shared setup](../README.md). Install the matching Chromium explicitly if needed:

```sh
npx flowstride install chromium
```

## 1. Run the self-contained microphone demo

The included [microphone-tone.wav](fixtures/microphone-tone.wav) is a short generated tone. The demo requests `getUserMedia`, measures actual microphone input and produces a deterministic transcript-like response when it detects a signal. This checks input delivery, recording controls, waiting and assertions; it is not a speech-recognition accuracy test.

[microphone-demo.flow](flows/microphone-demo.flow):

```flow
Feature: Microphone and transcript UI fixture
Scenario: Capture a known microphone signal
Given "Configure a PCM WAV before browser startup"
  flow.injectAudio "workflow-examples/audio-to-text/fixtures/microphone-tone.wav";
  flow.browser.permissions {
    "permissions": [
      "microphone"
    ]
  };
  flow.open "/audio";
When "Start recording"
  flow.click button "Start recording";
  flow.expect visible "Recording active";
When "Allow the fixture audio to play and stop"
  flow.waitForPipeline;
  flow.click button "Stop recording";
Then "The simulated transcription result is displayed"
  flow.expect transcript contains "Fixture transcript: audio received.";
  flow.assert.that {
    "selector": "#transcript",
    "condition": "text",
    "value": "Fixture transcript: audio received."
  };
```

```sh
npx flowstride run workflow-examples/audio-to-text/flows/microphone-demo.flow --browser chromium --ci
```

Expected: recording becomes active, non-silent microphone input is captured, recording stops, and the displayed result is `Fixture transcript: audio received.`. The run exits `0`.

The fixture path is literal and relative to the project root after the shared copy step. The engine reads the first literal audio fixture before browser startup. It does not resolve flow variables in that pre-launch path or hot-swap recordings during an active browser session. Run different audio fixtures in separate invocations.

## 2. Confirm a wrong transcript fails

```sh
npx flowstride run workflow-examples/audio-to-text/negative/wrong-transcript.flow --browser chromium --ci
```

This captures audio but expects a phrase the demo never produces. It must fail and exit nonzero. Inspect its failed assertion and media.

Firefox and WebKit reject `flow.injectAudio` explicitly. Keep audio cases in a Chromium job instead of adding them indiscriminately to a three-browser matrix.

## 3. Adapt to a real transcription service

Use [real-transcription.flow](templates/real-transcription.flow) with your recording application. Put a known spoken recording at the literal project path `fixtures/voice-note.wav`. Use an uncompressed PCM WAV with a conventional 44-byte header; changing a file extension does not convert its audio format.

Configure private application values:

```dotenv
TRANSCRIPTION_URL=https://your-test-application.example/record
EXPECTED_TRANSCRIPT="the known words spoken in the recording"
```

The template is:

```flow
Feature: Verify a real application's speech transcription

  Scenario: Record known spoken audio and check the resulting transcript
    Given "A spoken PCM WAV and an authorized recording page"
      flow.injectAudio "fixtures/voice-note.wav";
      flow.browser.permissions {
        "permissions": ["microphone"]
      };
      flow.open "{{env.TRANSCRIPTION_URL}}";

    When "Start the application's recording"
      flow.click button "Start recording";
      flow.expect visible "Recording active";

    When "Allow the audio clip to play and stop recording"
      flow.waitForPipeline;
      flow.click button "Stop recording";

    Then "The new transcript contains the expected spoken words"
      flow.assert.that {
        "selector": "#transcript",
        "condition": "containsText",
        "value": "{{env.EXPECTED_TRANSCRIPT}}",
        "timeout": 60000
      };
```

Adapt the recording buttons, recording-state label and transcript selector to your application. If authentication is required, add the normal application login or restore a saved browser session before opening the recording page. The application must have a working transcription service and suitable access to it.

```sh
npx flowstride run workflow-examples/audio-to-text/templates/real-transcription.flow --browser chromium --ci
```

Expected: the application receives the spoken audio and the **newly produced** transcript contains the known phrase. This is the service-backed check; the local tone demo cannot establish that result.

## Timing and comparison

| Command | Behavior |
| --- | --- |
| `flow.injectAudio` | Configures the file used as Chromium microphone input |
| `flow.browser.permissions` | Grants microphone permission to the current browser profile |
| `flow.waitForPipeline` | Estimates a wait from the WAV header, approximately the clip duration plus a half second |
| `flow.expect transcript contains` | Polls rendered page-body text after lowercasing, removing punctuation and collapsing whitespace |
| `flow.assert.that` with `selector` | Checks the specific result element and supports an explicit timeout |

`flow.waitForPipeline` does not observe an upload, server job or actual playback completion. Assert the recording state and final application result separately. Browser video alone does not prove microphone input or transcription succeeded.

The transcript helper normalizes ASCII word characters and searches the page body. Static example text or old transcripts can satisfy it. Clear old results and prefer a scoped assertion for the new transcript, especially for accented/non-Latin text. If the result is in an input/textarea, use the native `value` condition rather than `text`.

Use a browser-trusted origin such as localhost or HTTPS. Check microphone permission, fixture format, capture start/stop timing and service latency when diagnosing failures. Cloud can run these same browser commands; recording or transcription service credentials remain application prerequisites.
