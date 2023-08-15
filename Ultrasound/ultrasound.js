/* eslint-disable no-console */
/*
# Ultrasound Button Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.1
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GUARANTEE
#
# Usage - Allows changing Ultrasound from the UI
#
# Change History
# 1.0 20220616 Initial Release
# 1.1 20230815 Refactor code
#
*/
// eslint-disable-next-line import/no-unresolved
import xapi from 'xapi';

const panelId = 'ultrasound'; // Action Button Identifier
const ultrasoundVolume = 70; // Volume level to use when enabling
const buttonEnabled = true; // Adds / Removes button from UI
const debugMode = true; // Enable debug logging

async function addButton() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions && config.Extensions.Panel) {
    const ultrasound = config.Extensions.Panel.find(
      (panel) => panel.PanelId === panelId,
    );
    if (ultrasound) {
      if (debugMode) console.debug('Ultrasound already added');
      return;
    }
  }

  const result = await xapi.Config.Audio.Ultrasound.MaxVolume.get();
  let initialColor = '#30D557';
  if (result === 0) {
    initialColor = '#FF503C';
  }
  if (debugMode) console.debug('Adding Ultrasound');
  const xml = `<?xml version="1.0"?>
  <Extensions>
  <Version>1.8</Version>
  <Panel>
    <Order>1</Order>
    <PanelId>${panelId}</PanelId>
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
      PanelId: panelId,
    },
    xml,
  );
}

async function removeButton() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions && config.Extensions.Panel) {
    const panelExist = config.Extensions.Panel.find(
      (panel) => panel.PanelId === panelId,
    );
    if (!panelExist) {
      if (debugMode) console.debug('Ultrasound does not exist');
      return;
    }
  }

  console.debug('Removing Ultrasound');
  await xapi.Command.UserInterface.Extensions.Panel.Close();
  await xapi.Command.UserInterface.Extensions.Panel.Remove({
    PanelId: panelId,
  });
}

async function setButton(volume) {
  if (volume === '0') {
    await xapi.Command.UserInterface.Extensions.Panel.Update({
      PanelId: 'ultrasound',
      Color: '#FF503C',
    });
    if (debugMode) console.info('Ultrasound Disabled');
  } else {
    xapi.Command.UserInterface.Extensions.Panel.Update({
      PanelId: 'ultrasound',
      Color: '#30D557',
    });
    if (debugMode) console.info('Ultrasound Enabled');
  }
}

// Init function
function init() {
  // Process Macro Status
  if (buttonEnabled) {
    addButton();
  } else {
    removeButton();
  }

  // Monitor for Ultrasound Volume Changes
  xapi.Status.Audio.Ultrasound.Volume.on(async (volume) => {
    await setButton(volume);
  });

  // Monitor for Panel Click Events
  xapi.Event.UserInterface.Extensions.Panel.Clicked.on(async (event) => {
    if (event.PanelId === 'ultrasound') {
      const result = await xapi.Config.Audio.Ultrasound.MaxVolume.get();
      if (result === '0') {
        // Enable Ultrasound
        await xapi.config.set(
          'Audio Ultrasound MaxVolume:',
          `${ultrasoundVolume}`,
        );
      } else {
        // Disable Ultrasound
        await xapi.Config.Audio.Ultrasound.MaxVolume.set('0');
      }
    }
  });
}

// Initialize Function
init();
