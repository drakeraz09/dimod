/* eslint-disable import/no-unresolved */
import sprite1 from "!raw-loader!./ae1546a5b361ee39fef852e385e47e18.svg";
import sprite2 from "!raw-loader!./c782f2ee964beabce6c167a8f96ca052.svg";
import sprite3 from "!raw-loader!./cd21514d0531fdffb22204e0ec5ed84a.svg";
/* eslint-enable import/no-unresolved */

import projectData from "./project-data";
import { TextEncoder } from "../tw-text-encoder";

export const MISSING_PROJECT_ID = "__missing__";

const missingProject = () => {
    const encoder = new TextEncoder();

    const projectJson = projectData();
    return [
        {
            id: MISSING_PROJECT_ID,
            assetType: "Project",
            dataFormat: "JSON",
            data: JSON.stringify(projectJson),
        },
        {
            id: "ae1546a5b361ee39fef852e385e47e18",
            assetType: "ImageVector",
            dataFormat: "SVG",
            data: encoder.encode(sprite1),
        },
        {
            id: "c782f2ee964beabce6c167a8f96ca052",
            assetType: "ImageVector",
            dataFormat: "SVG",
            data: encoder.encode(sprite2),
        },
        {
            id: "cd21514d0531fdffb22204e0ec5ed84a",
            assetType: "ImageVector",
            dataFormat: "SVG",
            data: encoder.encode(sprite3),
        },
    ];
};

export default missingProject;
