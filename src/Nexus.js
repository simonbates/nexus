/*
Copyright 2015, 2016, 2017 OCAD University

Licensed under the New BSD license. You may not use this file except in
compliance with this License.

You may obtain a copy of the License at
https://raw.githubusercontent.com/fluid/infusion-nexus/master/LICENSE.txt
*/

/* eslint-env node */

"use strict";

var fluid = require("infusion");

fluid.defaults("fluid.nexus", {
    gradeNames: ["kettle.app"],
    components: {
        nexusComponentRoot: {
            type: "fluid.component"
        }
    },
    requestHandlers: {
        readDefaults: {
            route: "/defaults/:gradeName",
            method: "get",
            type: "fluid.nexus.readDefaults.handler"
        },
        writeDefaults: {
            route: "/defaults/:gradeName",
            method: "put",
            type: "fluid.nexus.writeDefaults.handler"
        },
        constructComponent: {
            route: "/components/:path",
            method: "post",
            type: "fluid.nexus.constructComponent.handler"
        },
        destroyComponent: {
            route: "/components/:path",
            method: "delete",
            type: "fluid.nexus.destroyComponent.handler"
        },
        bindModel: {
            route: "/bindModel/:componentPath/:modelPath",
            type: "fluid.nexus.bindModel.handler"
        }
    }
});

fluid.defaults("fluid.nexus.readDefaults.handler", {
    gradeNames: ["kettle.request.http"],
    invokers: {
        handleRequest: {
            funcName: "fluid.nexus.readDefaults.handleRequest",
            args: ["{request}.req.params.gradeName", "{request}"]
        }
    }
});

fluid.nexus.readDefaults.handleRequest = function (gradeName, request) {
    var defaults = fluid.defaults(gradeName);
    if (defaults) {
        request.events.onSuccess.fire(defaults);
    } else {
        request.events.onError.fire({
            message: "Grade not found",
            statusCode: 404
        });
    }
};

fluid.defaults("fluid.nexus.writeDefaults.handler", {
    gradeNames: ["kettle.request.http"],
    invokers: {
        handleRequest: {
            funcName: "fluid.nexus.writeDefaults.handleRequest",
            args: ["{request}.req.params.gradeName", "{request}"]
        }
    }
});

fluid.nexus.writeDefaults.handleRequest = function (gradeName, request) {
    fluid.defaults(gradeName, request.req.body);
    request.events.onSuccess.fire();
};

fluid.defaults("fluid.nexus.constructComponent.handler", {
    gradeNames: ["kettle.request.http"],
    invokers: {
        handleRequest: {
            funcName: "fluid.nexus.constructComponent.handleRequest",
            args: ["{request}.req.params.path", "{request}", "{fluid.nexus}.nexusComponentRoot"]
        }
    }
});

// TODO: Complain when component cannot be constructed due to parent not existing
fluid.nexus.constructComponent.handleRequest = function (path, request, componentRoot) {
    var segs = fluid.pathUtil.parseEL(path);
    fluid.nexus.constructInContainer(componentRoot, segs, request.req.body);
    request.events.onSuccess.fire();
};

fluid.defaults("fluid.nexus.destroyComponent.handler", {
    gradeNames: ["kettle.request.http"],
    invokers: {
        handleRequest: {
            funcName: "fluid.nexus.destroyComponent.handleRequest",
            args: ["{request}.req.params.path", "{request}", "{fluid.nexus}.nexusComponentRoot"]
        }
    }
});

// TODO: Complain when component is not found
fluid.nexus.destroyComponent.handleRequest = function (path, request, componentRoot) {
    var segs = fluid.pathUtil.parseEL(path);
    fluid.nexus.destroyInContainer(componentRoot, segs);
    request.events.onSuccess.fire();
};

fluid.defaults("fluid.nexus.bindModel.handler", {
    gradeNames: ["kettle.request.ws"],
    members: {
        // We store the targetComponent inside a container so that the
        // component is isolated from IoC references. This will not be
        // necessary in the future after upcoming framework changes
        // are completed.
        // See https://issues.fluidproject.org/browse/FLUID-4925
        componentHolder: {
            targetComponent: null // Will be set at onBindWs
        },
        modelPathSegs: null, // Will be set at onBindWs
        targetModelChangeListenerId: null // Will be set at onBindWs
    },
    invokers: {
        targetModelChangeListener: {
            funcName: "fluid.nexus.bindModel.targetModelChangeListener",
            args: [
                "{that}",
                "{arguments}.0" // value
            ]
        }
    },
    listeners: {
        onBindWs: {
            funcName: "fluid.nexus.bindModel.bindWs",
            args: [
                "{that}",
                "{request}.req.params.componentPath",
                "{request}.req.params.modelPath",
                "{that}.targetModelChangeListener",
                "{fluid.nexus}.nexusComponentRoot"
            ]
        },
        onReceiveMessage: {
            funcName: "fluid.nexus.bindModel.receiveMessage",
            args: [
                "{that}.componentHolder.targetComponent",
                "{that}.modelPathSegs",
                "{arguments}.1" // message
            ]
        },
        onDestroy: {
            "this": "{that}.componentHolder.targetComponent.applier.modelChanged",
            method: "removeListener",
            args: ["{that}.targetModelChangeListenerId"]
        }
    }
});

fluid.nexus.bindModel.bindWs = function (handler, componentPath, modelPath, modelChangeListener, componentRoot) {
    handler.componentHolder.targetComponent = fluid.nexus.componentForPathInContainer(componentRoot, componentPath);
    // TODO: Note that applier.modelchanged.addListener is different from https://wiki.fluidproject.org/display/fluid/Nexus+API
    //       Which says applier.addModelListener
    handler.modelPathSegs = fluid.pathUtil.parseEL(modelPath);
    handler.targetModelChangeListenerId = fluid.allocateGuid();
    handler.componentHolder.targetComponent.applier.modelChanged.addListener(
        {
            segs: handler.modelPathSegs,
            listenerId: handler.targetModelChangeListenerId
        },
        modelChangeListener
    ); // TODO: namespace?

    // On connect, send a message with the state of the component's model at modelPath
    handler.sendMessage(fluid.get(handler.componentHolder.targetComponent.model, handler.modelPathSegs));
};

fluid.nexus.bindModel.targetModelChangeListener = function (handler, value) {
    handler.sendMessage(value);
};

fluid.nexus.bindModel.receiveMessage = function (component, baseModelPathSegs, message) {
    var messagePathSegs = fluid.pathUtil.parseEL(message.path);
    var changePathSegs = baseModelPathSegs.concat(messagePathSegs);
    component.applier.fireChangeRequest(
        {
            segs: changePathSegs,
            value: message.value,
            type: message.type
        }
    );
};
