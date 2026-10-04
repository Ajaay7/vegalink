module.exports = {
    dependency: {
        platforms: {
            kepler: {
                "autolink": {
                    "VegaLinkCore": {
                        "libraryName": "libVegaLinkCore.so",
                        "linkDynamic": true,
                        "provider": "application",
                        "components": [],
                        "turbomodules": [
                            "VegaLinkCore"
                        ]
                    }
                }
            },
        },
    },
};