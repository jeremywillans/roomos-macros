/*
# Ultrasound Button Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.0
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GUARANTEE
#
# Usage - Allows changing Ultrasound from the UI
#
# Change History
# 1.0 20220616 Initial Release
#
*/
import xapi from "xapi";

const ULTRASOUND_ID = "ultrasound"; // Action Button Identifier
const ULTRASOUND_VOLUME = 70; // Volume level to use when enabling
const BUTTON_ENABLED = true; // Adds/Removes button from UI

async function addButton() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions && config.Extensions.Panel) {
    const ultrasound = config.Extensions.Panel.find(
      (panel) => panel.PanelId === ULTRASOUND_ID
    );
    if (ultrasound) {
      console.debug("Ultrasound already added");
      return;
    }
  }

  const result = await xapi.config.get("Audio Ultrasound MaxVolume");
  let initialColor = "#30D557";
  if (result === 0) {
    initialColor = "#FF503C";
  }
  console.debug(`Adding Ultrasound`);
  const xml = `<?xml version="1.0"?>
  <Extensions>
  <Version>1.8</Version>
  <Panel>
    <Order>1</Order>
    <PanelId>${ULTRASOUND_ID}</PanelId>
    <Origin>local</Origin>
    <Type>Home</Type>
    <Icon>Proximity</Icon>
    <Color>${initialColor}</Color>
    <Name>Ultrasound</Name>
    <ActivityType>Custom</ActivityType>
  </Panel>
  </Extensions>`;

  await xapi.Command.UserInterface.Extensions.Panel.Save(
    {
      PanelId: ULTRASOUND_ID,
    },
    xml
  );
}

async function removeButton() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions && config.Extensions.Panel) {
    const panelExist = config.Extensions.Panel.find(
      (panel) => panel.PanelId === ULTRASOUND_ID
    );
    if (!panelExist) {
      console.debug("Ultrasound does not exist");
      return;
    }
  }

  console.debug(`Removing Ultrasound`);
  await xapi.Command.UserInterface.Extensions.Panel.Close();
  await xapi.Command.UserInterface.Extensions.Panel.Remove({
    PanelId: ULTRASOUND_ID,
  });
}

async function setButton(volume) {
  if (volume === "0") {
    await xapi.Command.UserInterface.Extensions.Panel.Update({
      PanelId: "ultrasound",
      Color: "#FF503C",
    });
    console.info("Ultrasound Disabled");
  } else {
    xapi.Command.UserInterface.Extensions.Panel.Update({
      PanelId: "ultrasound",
      Color: "#30D557",
    });
    console.info("Ultrasound Enabled");
  }
}

// Init function
function init() {
  // Process Macro Status
  if (BUTTON_ENABLED) {
    addButton();
  } else {
    removeButton();
  }

  // Monitor for Ultrasound Volume Changes
  xapi.Status.Audio.Ultrasound.Volume.on(async (volume) => {
    await setButton(volume);
  });

  // Monitor for Panel Click Events
  xapi.event.on("UserInterface Extensions Panel Clicked", async (event) => {
    if (event.PanelId == "ultrasound") {
      const result = await xapi.config.get("Audio Ultrasound MaxVolume");
      if (result === "0") {
        // Enable Ultrasound
        await xapi.config.set(
          "Audio Ultrasound MaxVolume:",
          `${ULTRASOUND_VOLUME}`
        );
      } else {
        // Disable Ultrasound
        await xapi.config.set("Audio Ultrasound MaxVolume:", "0");
      }
    }
  });
}

// Initialize Function
init();
