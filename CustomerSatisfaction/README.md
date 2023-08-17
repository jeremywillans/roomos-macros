# Customer Satisfaction

![RoomOS10-Yes](https://img.shields.io/badge/RoomOS%2010-Compatible-green.svg?style=for-the-badge&logo=cisco) ![RoomOS11-Yes](https://img.shields.io/badge/RoomOS%2011-Compatible-green.svg?style=for-the-badge&logo=cisco)

Macro for showing a Customer Satisfaction survey after each call.

Allows data to be posted to a Webex Space, sent to a HTTP Server (such as Power Bi or Loki Logging) and/or an Incident raised in Service Now

Provides 4 simple questions
- Satisfaction (Excellent, Average, Poor)
- Issue (Audio/Video, Content Sharing, Other)
- Feedback
- Email Address (if provided, will link to Caller in Service Now)

Does not require all questions to be completed for data to be captured, any data entered will be used for processing.

![img1.png](img/img1.png)
![img2.png](img/img2.png)

## Prerequisites

The following items are needed, depending on the enabled services.

**Webex Space**
- A Webex Bot - create at [developer.webex.com](https://developer.webex.com/my-apps/new/bot) 
- An existing Webex Space with the Webex bot as a member.
- The RoomId of the destination Webex space. These example methods can be used to get the Room Id
  - Using the [List Rooms](https://developer.webex.com/docs/api/v1/rooms/list-rooms) Developer API
  - Adding `astronaut@webex.bot` to the space (bot will leave and 1:1 you the Id)

**Service Now**
- A User account with the `sn_incident_write` permission
- The URL of your Service Now instance
- Credentials for the above user account, encoded in Base64 in the following format `username:password`
- Macro searching CMDB using Serial Number to match CI Entity
- Extra Parameters (such as Assignment group) can also be passed to Service Now

**HTTP JSON**
- A remote service capable of receiving HTTP POST messages, including Power BI Streaming Dataset.
- (Example) [CSV Server](https://github.com/jeremywillans/csv-server) can be used to test receiving messages and storing them in a CSV File
- The following format is used for the JSON Message
  ```
  {"timestamp":1662605028489,"system":"Test_Endpoint","serial":"FOC123456AA","software":"ce10.19.1.2.bb4292d4368","rating":2,"rating_fmt":"Average","destination":"spark:123456789@webex.com","call_type":"webex","duration":15,"duration_fmt":"15 seconds","cause":"LocalDisconnect","issue":1,"issue_fmt":"Audio/Video","feedback":"Example feedback","reporter":"user@example.com","voluntary":true}
  ```

  **Note:** If enabling the Power Bi option, the timestamp (normally EPOC) is modified to the 'DateTime' format which is supported for the streaming dataset.

  Example API Info for PowerBI
  
  ![powerbi.png](img/powerbi.png)

## Deployment

1. Download the Macro file and upload to your Webex device.
2. Update the Parameters and Enabled Services, outlined at the top of the Macro
3. Make a test call! (noting the Call Duration value before the survey is displayed)

## Debugging

The macro contains two events for testing the Survey without the need to make outbound calls.

These can be invoked by creating an Action button from the UI Extensions Editor and setting the Id as follows:
- `test_survey` - Using sample call data, this will show the Survey on the Touch Panel
- `test_services` - Using sample call and survey data, this will trigger processing the enabled services

## Support

In case you've found a bug, please [open an issue on GitHub](../../../issues).

## Disclaimer

This macro is NOT guaranteed to be bug free and production quality.

## Credits

- [CiscoDevNet](https://github.com/CiscoDevNet) for creating [roomdevices-macros-samples](https://github.com/CiscoDevNet/roomdevices-macros-samples) that this is based on!
