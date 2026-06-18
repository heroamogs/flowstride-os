"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowstrideEmitter = exports.FlowstrideEvents = void 0;
const events_1 = require("events");
var FlowstrideEvents;
(function (FlowstrideEvents) {
    FlowstrideEvents["RUN_START"] = "run:start";
    FlowstrideEvents["RUN_END"] = "run:end";
    FlowstrideEvents["FILE_START"] = "file:start";
    FlowstrideEvents["FILE_END"] = "file:end";
    FlowstrideEvents["SCENARIO_START"] = "scenario:start";
    FlowstrideEvents["SCENARIO_END"] = "scenario:end";
    FlowstrideEvents["STEP_START"] = "step:start";
    FlowstrideEvents["STEP_PASS"] = "step:pass";
    FlowstrideEvents["STEP_FAIL"] = "step:fail";
    FlowstrideEvents["STEP_NOT_TESTED"] = "step:not_tested";
})(FlowstrideEvents || (exports.FlowstrideEvents = FlowstrideEvents = {}));
class FlowstrideEmitter extends events_1.EventEmitter {
}
exports.FlowstrideEmitter = FlowstrideEmitter;
