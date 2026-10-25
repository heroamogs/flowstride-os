# Manual design, execution and saved results

The Manual Workspace lets you describe steps and expected results visually, perform those actions in your application, record outcomes and reopen a saved run. It is available in OS and Cloud. A human decides whether each manual step matches its expected result.

Complete the [shared setup](../README.md) and leave the local demo app running. The default application page for this chapter is `http://127.0.0.1:4107/profile`. If you changed the demo port, use the printed server URL and update the design instructions to match.

## 1. Load the supplied design

The fixture [profile-review.json](fixtures/profile-review.json) defines three connected steps, expected results, a Test Plan identifier and the local environment. Copy it into the normal project template folder:

```sh
mkdir -p manual_flows/templates
cp workflow-examples/manual-testing/fixtures/profile-review.json "manual_flows/templates/Profile review.json"
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force manual_flows/templates
Copy-Item workflow-examples/manual-testing/fixtures/profile-review.json "manual_flows/templates/Profile review.json"
```

Use a new destination filename when you already have a template with that name. Open the local workspace:

```sh
npx flowstride manual
```

Choose **Profile review** / its template filename from the flow selector. Refresh the workspace if it was open before the file was copied. Inspect the title, Test Plan, instructions and expected results. This JSON is a manual design, not an automated `.flow` test.

You can also create a design with **Step**, **Arrow**, **Group** and **Text**. The runtime starts with the lowest internal node ID and follows outgoing connections. Moving a node or changing its visible step label does not change its execution identity. Keep an unambiguous path and confirm the highlighted starting step.

## 2. Save and perform a passing run

In Design Mode, click **Save** and wait for confirmation. Switch to **Execution Mode**; the design is saved before the transition.

Open the demo application's `/profile` page in another tab/window and perform these actions:

| Step | Action | Expected result |
| --- | --- | --- |
| Open the sample profile | Open `/profile` | Display name is visible |
| Update the display name | Enter `Lola Idowu`, then click Save profile | The page shows `Saved as Lola Idowu` |
| Reopen the profile | Reload the application page | Display name still contains `Lola Idowu` |

After checking each result, return focus to the workspace canvas and press **Enter** to mark it Passed. All three steps should be Passed. The server keeps the profile change in memory; restarting it resets demo data.

If nodes extend beyond the viewport, pan with the Hand tool or use the zoom/recenter controls. The workspace's metadata environment label does not navigate or configure the application browser for you.

## 3. Save the execution record

| Engine | Button in Execution Mode |
| --- | --- |
| OS | **Save** |
| Cloud | **Submit Run** |

Wait for confirmation. The design remains under `manual_flows/templates`; the new run is stored separately under `manual_flows/runs`. A browser file download is not proof that a run was persisted: confirm the saved record in **Runs**.

The passing exercise should show three Passed steps and a PASS run summary. Keep your template and referenced media together when backing up the project.

## 4. Reopen history

Open **Runs**, locate the saved record and select it. Check its saved flow name, step results and canvas. Review historical records as evidence of that execution; return to the design for a fresh run. Cloud presents a vaulted historical record with its editing controls locked.

Manual results are local records by default in OS. Cloud can synchronize manual results when valid Cloud credentials are configured. Check delivery status separately and avoid including real personal data in example evidence.

## 5. Practice a failure and skipped work

Copy [profile-review-mismatch.json](fixtures/profile-review-mismatch.json) into the template folder under its own filename and open it as another design. It deliberately expects `Saved as A Different Person` after you enter `Lola Idowu`.

Perform the first action and record Passed. At the mismatching second step, observe the actual application result and record Failed. For this exercise, mark the remaining follow-up step Skipped and save/submit the run. Expected: one Passed, one Failed, one Skipped, and an overall FAIL summary. Skipped work must not be reported as verified success.

In Execution Mode, focus the canvas before using these shortcuts:

| Key | Result |
| --- | --- |
| Enter | Passed |
| Delete / Backspace | Failed |
| Tab | Blocked |
| Escape | Skipped |

These keys have different meanings in Design Mode. A focused text editor may consume them instead of the canvas.

Expand **Failure Details** for the failed step. Describe the actual versus expected outcome, add appropriate evidence/assignee, save the defect form, and then save/submit the run. Confirm the recorded defect when reopening history. Design-reference media and defect evidence serve different purposes; keep uploads within the limits shown by their respective chooser.

The [manual documentation](https://docs.flowstride.io/manual-workspace/manual-testing) covers planning, canvas controls, evidence, reporting and collaboration in more detail.
