import { EventEmitter } from "events";
import { Scenario, ScenarioResult } from "../types";

export enum FlowstrideEvents {
  RUN_START = "run:start",
  RUN_END = "run:end",
  FILE_START = "file:start",
  FILE_END = "file:end",
  SCENARIO_START = "scenario:start",
  SCENARIO_END = "scenario:end",
  STEP_START = "step:start",
  STEP_PASS = "step:pass",
  STEP_FAIL = "step:fail",
  STEP_NOT_TESTED = "step:not_tested",
}

export class FlowstrideEmitter extends EventEmitter {}
