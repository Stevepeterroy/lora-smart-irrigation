#include "secrets.h" // Copy secrets.example.h and configure locally.
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <SPI.h>
#include <LoRa.h>

/*
   FINAL COMPATIBLE HOME CONTROLLER
   --------------------------------
   Firebase <-> Home ESP32 <-> LoRa <-> Field ESP32

   No OTA is included. The web app currently does not use OTA.
   Motor actual state comes ONLY from Field STATUS/current sensing.
   Command retries reuse the SAME command ID.
*/
#include <time.h>

/*
   =========================================================
                     HOME ESP32
             WiFi + Firebase + LoRa
   =========================================================

   DEVICE:
       farm001

   ARCHITECTURE:

       WEB APP
          |
          | Firebase
          v
       HOME ESP32
          |
          | LoRa
          v
       FIELD ESP32
          |
          v
       MOTOR / RELAYS / SENSORS


   MOTOR COMMAND FLOW:

       Web App writes:

       motor/command       = ON / OFF (START / STOP also accepted)
       motor/command_id    = unique ID
       motor/command_status = pending

                    ↓

       HOME ESP32

                    ↓

       CMD:START|ID:xxxxx
       CMD:STOP|ID:xxxxx

                    ↓

       FIELD ESP32

                    ↓

       ACK:xxxxx

                    ↓

       HOME ESP32

                    ↓

       Firebase:

       motor/command_status = done


   IMPORTANT:

       motor/command = REQUEST

       motor/actual  = REAL PHYSICAL STATE

       ONLY FIELD ESP32 STATUS determines
       motor/actual.
   =========================================================
*/


/* =========================================================
                         WIFI
   ========================================================= */





/* =========================================================
                       FIREBASE
   ========================================================= */








FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;


/* =========================================================
                    FIREBASE BASE PATH
   ========================================================= */

const String BASE_PATH =
    "devices/farm001";


/* =========================================================
                           LORA
   ========================================================= */

#define LORA_SS        5
#define LORA_RST       14
#define LORA_DIO0      26

#define LORA_SCK       18
#define LORA_MISO      19
#define LORA_MOSI      23

#define LORA_FREQ      433E6

#define LORA_SF        12
#define LORA_BW        125E3
#define LORA_CR        5
#define LORA_SYNC      0x34
#define LORA_POWER     20

bool loraOK = false;


/* =========================================================
                    FIELD TIMEOUT
   ========================================================= */

#define FIELD_OFFLINE_TIMEOUT 30000UL

unsigned long lastFieldPacketMillis = 0;

bool fieldSeen = false;


/* =========================================================
                  COMMAND SYSTEM
   ========================================================= */

String lastProcessedCommandId = "";

String activeCommandId = "";
String activeCommand = "";

bool waitingAck = false;

unsigned long commandSendMillis = 0;

int commandRetryCount = 0;


/*
   LONG MOTOR COMMAND RETRY

   Initial transmission
       +
   6 retries

   Each retry waits 10 seconds for ACK.

   This gives the Field ESP32 plenty of time to
   receive/process/respond without changing the
   command ID.

   IMPORTANT:
   The SAME command ID is reused for every retry.
*/

#define MAX_RETRY       3
#define ACK_TIMEOUT     5000UL


/* =========================================================
                 FIREBASE COMMAND POLLING
   ========================================================= */

unsigned long lastCommandCheck = 0;

#define COMMAND_CHECK_INTERVAL 1000UL


/* =========================================================
                          TIMERS
   ========================================================= */

unsigned long lastHomeStatus = 0;
unsigned long lastSignalPush = 0;
unsigned long lastCurrentPush = 0;
unsigned long lastStatusRequest = 0;
unsigned long fieldStatusRequestMillis = 0;
unsigned long lastWiFiRetry = 0;
unsigned long lastSerialSummary = 0;

#define HOME_STATUS_INTERVAL       3000UL
#define SIGNAL_HISTORY_INTERVAL    5000UL
#define CURRENT_HISTORY_INTERVAL  10000UL
#define FIELD_STATUS_REQUEST       5000UL
#define FIELD_STATUS_RESPONSE_TIMEOUT 8000UL
#define WIFI_RETRY_INTERVAL       10000UL
#define SERIAL_SUMMARY_INTERVAL    5000UL


/* =========================================================
                     FIELD STATUS
   ========================================================= */

float fieldCurrent = 0.0;

int fieldPSR = 0;

int fieldPSRRaw = 0;

String fieldMotor = "UNKNOWN";

int fieldRSSI = 0;

float fieldSNR = 0.0;

bool waitingFieldStatus = false;


/* =========================================================
             DEFERRED FIELD FIREBASE SYNC
   =========================================================

   IMPORTANT:
   Never perform slow Firebase network operations while
   processing a LoRa packet. LoRa RX must return to the
   receive loop immediately so packets are not missed.
   ========================================================= */

bool fieldStatusDirty = false;
bool runtimeUpdatePending = false;
unsigned long lastFieldFirebaseSync = 0;

#define FIELD_FIREBASE_SYNC_INTERVAL 3000UL


/* =========================================================
                    MOTOR RUNTIME
   ========================================================= */

bool previousMotorOn = false;

unsigned long motorRuntimeStartMillis = 0;

bool runtimeSessionActive = false;


/* =========================================================
                       TIME HELPERS
   ========================================================= */

bool getValidTime(time_t &now)
{
    now = time(nullptr);

    return now > 100000;
}


/* =========================================================
                   FIELD ONLINE STATUS
   ========================================================= */

bool isFieldOnline()
{
    if (!fieldSeen)
        return false;

    return (
        millis() -
        lastFieldPacketMillis <
        FIELD_OFFLINE_TIMEOUT
    );
}


/* =========================================================
                FIREBASE AVAILABILITY
   ========================================================= */

bool firebaseAvailable()
{
    if (
        WiFi.status() !=
        WL_CONNECTED
    )
    {
        return false;
    }

    return Firebase.ready();
}


/* =========================================================
              FIREBASE STRING HELPER
   ========================================================= */

bool firebaseString(
    const String &path,
    const String &value)
{
    if (!firebaseAvailable())
        return false;

    bool result =
        Firebase.RTDB.setString(
            &fbdo,
            BASE_PATH + path,
            value
        );

    if (!result)
    {
        Serial.print(
            "Firebase String ERROR: "
        );

        Serial.println(
            fbdo.errorReason()
        );
    }

    return result;
}


/* =========================================================
                FIREBASE INT HELPER
   ========================================================= */

bool firebaseInt(
    const String &path,
    int value)
{
    if (!firebaseAvailable())
        return false;

    bool result =
        Firebase.RTDB.setInt(
            &fbdo,
            BASE_PATH + path,
            value
        );

    if (!result)
    {
        Serial.print(
            "Firebase Int ERROR: "
        );

        Serial.println(
            fbdo.errorReason()
        );
    }

    return result;
}


/* =========================================================
              FIREBASE FLOAT HELPER
   ========================================================= */

bool firebaseFloat(
    const String &path,
    float value)
{
    if (!firebaseAvailable())
        return false;

    bool result =
        Firebase.RTDB.setFloat(
            &fbdo,
            BASE_PATH + path,
            value
        );

    if (!result)
    {
        Serial.print(
            "Firebase Float ERROR: "
        );

        Serial.println(
            fbdo.errorReason()
        );
    }

    return result;
}


/* =========================================================
                FIREBASE LOG
   ========================================================= */

void pushLog(
    const String &message)
{
    if (!firebaseAvailable())
        return;

    time_t now;

    if (!getValidTime(now))
        return;

    FirebaseJson json;

    json.set(
        "time",
        (double)now * 1000.0
    );

    json.set(
        "message",
        message
    );

    bool result =
        Firebase.RTDB.pushJSON(
            &fbdo,
            BASE_PATH + "/logs",
            &json
        );

    if (!result)
    {
        Serial.print(
            "Log push ERROR: "
        );

        Serial.println(
            fbdo.errorReason()
        );
    }
}


/* =========================================================
                     SEND LORA
   ========================================================= */

bool sendLoRa(
    const String &packet)
{
    if (!loraOK)
    {
        Serial.println(
            "[LORA] TX BLOCKED - LoRa not ready"
        );

        return false;
    }

    /*
       Leave RX mode before TX.
    */

    LoRa.idle();

    int result =
        LoRa.beginPacket();

    if (result == 0)
    {
        Serial.println(
            "[LORA] beginPacket FAILED"
        );

        LoRa.receive();

        return false;
    }

    LoRa.print(
        packet
    );

    result =
        LoRa.endPacket();

    /*
       Always return to RX.
    */

    LoRa.receive();

    if (result == 0)
    {
        Serial.println(
            "[LORA] TX FAILED"
        );

        return false;
    }

    Serial.print(
        "[LORA TX] "
    );

    Serial.println(
        packet
    );

    return true;
}


/* =========================================================
                    GET FIELD VALUE
   ========================================================= */

String getFieldValue(
    const String &msg,
    const String &key)
{
    String searchKey =
        "|" +
        key +
        ":";

    int start =
        msg.indexOf(
            searchKey
        );

    if (start == -1)
        return "";

    start +=
        searchKey.length();

    int end =
        msg.indexOf(
            '|',
            start
        );

    if (end == -1)
    {
        end =
            msg.length();
    }

    return msg.substring(
        start,
        end
    );
}


/* =========================================================
                  UPDATE MOTOR RUNTIME
   ========================================================= */

void updateRuntime()
{
    bool motorOn =
        fieldMotor.equalsIgnoreCase(
            "ON"
        );


    /* =====================================================
                         OFF -> ON
       ===================================================== */

    if (
        motorOn &&
        !previousMotorOn
    )
    {
        previousMotorOn = true;

        runtimeSessionActive = true;

        motorRuntimeStartMillis =
            millis();

        time_t now;

        if (getValidTime(now))
        {
            firebaseInt(
                "/motor/last_on_time",
                (int)now
            );
        }

        pushLog(
            "Motor ON"
        );

        Serial.println(
            "[RUNTIME] Motor started"
        );

        return;
    }


    /* =====================================================
                         ON -> OFF
       ===================================================== */

    if (
        !motorOn &&
        previousMotorOn
    )
    {
        previousMotorOn = false;

        if (runtimeSessionActive)
        {
            unsigned long runtime =
                (
                    millis() -
                    motorRuntimeStartMillis
                )
                /
                1000UL;


            if (firebaseAvailable())
            {
                int today = 0;
                int week = 0;
                int month = 0;


                if (
                    Firebase.RTDB.getInt(
                        &fbdo,
                        BASE_PATH +
                        "/analytics/runtime_today"
                    )
                )
                {
                    today =
                        fbdo.intData();
                }


                if (
                    Firebase.RTDB.getInt(
                        &fbdo,
                        BASE_PATH +
                        "/analytics/runtime_week"
                    )
                )
                {
                    week =
                        fbdo.intData();
                }


                if (
                    Firebase.RTDB.getInt(
                        &fbdo,
                        BASE_PATH +
                        "/analytics/runtime_month"
                    )
                )
                {
                    month =
                        fbdo.intData();
                }


                firebaseInt(
                    "/analytics/runtime_today",
                    today +
                    (int)runtime
                );


                firebaseInt(
                    "/analytics/runtime_week",
                    week +
                    (int)runtime
                );


                firebaseInt(
                    "/analytics/runtime_month",
                    month +
                    (int)runtime
                );
            }


            runtimeSessionActive =
                false;
        }


        pushLog(
            "Motor OFF"
        );


        Serial.println(
            "[RUNTIME] Motor stopped"
        );
    }
}


/* =========================================================
                  PARSE FIELD STATUS
   ========================================================= */

void parseFieldStatus(
    const String &msg)
{
    /*
       Expected:

       STATUS
       |CURRENT:8.30
       |PSR:ON
       |PSR_RAW:0
       |MOTOR:ON
       |RSSI:-67
       |SNR:9.20
    */


    /* =====================================================
                         CURRENT
       ===================================================== */

    String currentValue =
        getFieldValue(
            msg,
            "CURRENT"
        );


    if (
        currentValue.length() > 0
    )
    {
        fieldCurrent =
            currentValue.toFloat();

    }


    /* =====================================================
                           PSR
       ===================================================== */

    String psrValue =
        getFieldValue(
            msg,
            "PSR"
        );


    if (
        psrValue.length() > 0
    )
    {
        psrValue.trim();


        if (
            psrValue.equalsIgnoreCase(
                "ON"
            )
        )
        {
            fieldPSR = 1;
        }

        else if (
            psrValue.equalsIgnoreCase(
                "OFF"
            )
        )
        {
            fieldPSR = 0;
        }

        else
        {
            fieldPSR =
                psrValue.toInt();
        }


    }


    /* =====================================================
                         PSR RAW
       ===================================================== */

    String psrRawValue =
        getFieldValue(
            msg,
            "PSR_RAW"
        );


    if (
        psrRawValue.length() > 0
    )
    {
        fieldPSRRaw =
            psrRawValue.toInt();

    }


    /* =====================================================
                          MOTOR
       ===================================================== */

    String motorValue =
        getFieldValue(
            msg,
            "MOTOR"
        );


    if (
        motorValue.length() > 0
    )
    {
        motorValue.trim();

        motorValue.toUpperCase();

        fieldMotor =
            motorValue;


        /*
           IMPORTANT:

           This is the ONLY place where Home
           learns the actual motor state.

           The command does NOT change motor/actual.
        */

        /*
           Runtime/Firebase work is deferred until after the
           LoRa packet has been completely processed.
        */
        runtimeUpdatePending = true;
    }


    /* =====================================================
                           RSSI
       ===================================================== */

    String rssiValue =
        getFieldValue(
            msg,
            "RSSI"
        );


    if (
        rssiValue.length() > 0
    )
    {
        fieldRSSI =
            rssiValue.toInt();
    }


    /* =====================================================
                            SNR
       ===================================================== */

    String snrValue =
        getFieldValue(
            msg,
            "SNR"
        );


    if (
        snrValue.length() > 0
    )
    {
        fieldSNR =
            snrValue.toFloat();
    }


    /* =====================================================
                       FIELD SEEN
       ===================================================== */

    fieldSeen = true;

    lastFieldPacketMillis =
        millis();

    fieldStatusDirty = true;


    /* =====================================================
                         SERIAL
       ===================================================== */

    Serial.println();

    Serial.println(
        "========== FIELD STATUS =========="
    );


    Serial.print(
        "Field ESP32 : "
    );

    Serial.println(
        isFieldOnline()
        ? "ONLINE"
        : "OFFLINE"
    );


    Serial.print(
        "Motor       : "
    );

    Serial.println(
        fieldMotor
    );


    Serial.print(
        "Current     : "
    );

    Serial.print(
        fieldCurrent,
        2
    );

    Serial.println(
        " A"
    );


    Serial.print(
        "PSR         : "
    );

    Serial.println(
        fieldPSR
        ? "OK"
        : "FAULT / OFF"
    );


    Serial.print(
        "PSR RAW     : "
    );

    Serial.println(
        fieldPSRRaw
    );


    Serial.print(
        "RSSI        : "
    );

    Serial.print(
        fieldRSSI
    );

    Serial.println(
        " dBm"
    );


    Serial.print(
        "SNR         : "
    );

    Serial.print(
        fieldSNR,
        2
    );

    Serial.println(
        " dB"
    );


    Serial.println(
        "=================================="
    );
}


/* =========================================================
             SYNC FIELD STATUS TO FIREBASE
   ========================================================= */

// FirebaseJson.set("motor/actual", ...) creates a nested motor object.
// updateNode at BASE_PATH would replace motor and erase pending commands/timers.
// add() keeps each slash-delimited key literal for an RTDB multi-location PATCH.
// Keep the status string compatible, but tag its originating request atomically.
// A late ACK for START must not acknowledge a newer STOP request.
bool writeMotorCommandStatus(const String &status, const String &id)
{
    if (!firebaseAvailable()) return false;
    FirebaseJson patch;
    patch.add("command_status", status);
    patch.add("command_status_id", id);
    return Firebase.RTDB.updateNode(&fbdo, BASE_PATH + "/motor", &patch);
}

void syncFieldStatusToFirebase()
{
    if (!fieldStatusDirty)
        return;

    if (
        millis() -
        lastFieldFirebaseSync <
        FIELD_FIREBASE_SYNC_INTERVAL
    )
        return;

    if (!firebaseAvailable())
        return;

    lastFieldFirebaseSync = millis();

    FirebaseJson json;

    json.add(
        "current/amps",
        fieldCurrent
    );

    json.add(
        "psr/ok",
        fieldPSR
    );

    json.add(
        "psr/raw",
        fieldPSRRaw
    );

    /* Real three-phase availability follows the Field PSR state. */
    json.add(
        "phase/available",
        fieldPSR
    );

    json.add(
        "motor/actual",
        fieldMotor
    );

    json.add(
        "lora/rssi",
        fieldRSSI
    );

    json.add(
        "lora/snr",
        fieldSNR
    );

    time_t now;

    if (getValidTime(now))
    {
        json.add(
            "lora/field_last_seen",
            (int)now
        );
    }

    if (
        Firebase.RTDB.updateNode(
            &fbdo,
            BASE_PATH,
            &json
        )
    )
    {
        fieldStatusDirty = false;
    }
    else
    {
        Serial.print(
            "Field Firebase sync ERROR: "
        );

        Serial.println(
            fbdo.errorReason()
        );
    }
}


/* =========================================================
                    RECEIVE LORA
   ========================================================= */

void receiveLoRa()
{
    if (!loraOK)
        return;


    int packetSize =
        LoRa.parsePacket();


    if (!packetSize)
        return;


    String msg = "";


    while (
        LoRa.available()
    )
    {
        msg +=
            (char)LoRa.read();
    }


    msg.trim();


    /*
       A STATUS response ends the protected receive window
       immediately, before any Firebase work can run.
    */

    if (
        waitingFieldStatus &&
        msg.startsWith(
            "STATUS|"
        )
    )
    {
        waitingFieldStatus = false;

        Serial.println(
            "[STATUS] Field STATUS response received"
        );
    }


    int rssi =
        LoRa.packetRssi();


    float snr =
        LoRa.packetSnr();


    /* =====================================================
                           LINK
       ===================================================== */

    fieldSeen = true;

    lastFieldPacketMillis =
        millis();


    fieldRSSI =
        rssi;

    fieldSNR =
        snr;


    /*
       Do not touch Firebase here.
       LoRa RX must stay fast.
    */

    time_t now;

    bool validTime =
        getValidTime(now);


    /* =====================================================
                      RAW PACKET
       ===================================================== */

    Serial.println();

    Serial.println(
        "========== LoRa RX =========="
    );


    Serial.print(
        "Message : "
    );

    Serial.println(
        msg
    );


    Serial.print(
        "RSSI    : "
    );

    Serial.print(
        rssi
    );

    Serial.println(
        " dBm"
    );


    Serial.print(
        "SNR     : "
    );

    Serial.print(
        snr,
        2
    );

    Serial.println(
        " dB"
    );


    /* =====================================================
                       FIELD READY
       ===================================================== */

    if (
        msg ==
        "FIELD_READY"
    )
    {
        firebaseString(
            "/status/field_esp32",
            "online"
        );


        firebaseString(
            "/status/field_lora",
            "online"
        );


        pushLog(
            "Field ESP32 online"
        );


        Serial.println(
            "[FIELD] FIELD ESP32 ONLINE"
        );


        /*
           Do not immediately send STATUS here.
           The normal status scheduler will poll Field.
        */

        return;
    }


    /* =====================================================
                           ACK
       ===================================================== */

    if (
        msg.startsWith(
            "ACK:"
        )
    )
    {
        String id =
            msg.substring(
                4
            );


        id.trim();


        Serial.print(
            "[ACK] Received ID: "
        );


        Serial.println(
            id
        );


        /*
           Only accept ACK for the currently
           active command.
        */

        if (
            waitingAck &&
            id ==
            activeCommandId
        )
        {
            waitingAck = false;

            commandRetryCount = 0;


            /*
               Field has accepted the command.
            */

            lastProcessedCommandId =
                activeCommandId;


            writeMotorCommandStatus("done", activeCommandId);


            Serial.println();

            Serial.println(
                "******** COMMAND ACK RECEIVED ********"
            );


            Serial.print(
                "Command : "
            );

            Serial.println(
                activeCommand
            );


            Serial.print(
                "ID      : "
            );

            Serial.println(
                activeCommandId
            );


            Serial.println(
                "Status  : DONE"
            );


            Serial.println(
                "****************************************"
            );


            pushLog(
                "Command completed: " +
                activeCommand
            );


            activeCommand = "";

            activeCommandId = "";


            return;
        }


        Serial.println(
            "[ACK] ACK does not match active command"
        );


        return;
    }


    /* =====================================================
                     FIELD STATUS
       ===================================================== */

    if (
        msg.startsWith(
            "STATUS|"
        )
    )
    {
        parseFieldStatus(
            msg
        );


        /*
           Analytics history is intentionally not written from
           the LoRa RX path. Core status is synchronized by
           syncFieldStatusToFirebase().
        */

        return;
    }


    /* =====================================================
                     UNKNOWN PACKET
       ===================================================== */

    Serial.println(
        "[LORA] Unknown packet"
    );
}


/* =========================================================
                  FIELD TIMEOUT
   ========================================================= */

void checkFieldTimeout()
{
    static bool previousState =
        false;


    bool currentState =
        isFieldOnline();


    if (
        currentState !=
        previousState
    )
    {
        previousState =
            currentState;


        firebaseString(
            "/status/field_esp32",
            currentState
            ? "online"
            : "offline"
        );


        firebaseString(
            "/status/field_lora",
            currentState
            ? "online"
            : "offline"
        );


        if (!currentState)
        {
            Serial.println();

            Serial.println(
                "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
            );

            Serial.println(
                "FIELD ESP32 / LoRa OFFLINE"
            );

            Serial.println(
                "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
            );
        }

        else
        {
            Serial.println();

            Serial.println(
                "FIELD ESP32 / LoRa ONLINE"
            );
        }
    }
}


/* =========================================================
              NORMALIZE MOTOR COMMAND
   ========================================================= */

String normalizeCommand(
    String command)
{
    command.trim();

    command.toUpperCase();


    if (
        command == "ON"
    )
    {
        return "START";
    }


    if (
        command == "OFF"
    )
    {
        return "STOP";
    }


    if (
        command == "START"
    )
    {
        return "START";
    }


    if (
        command == "STOP"
    )
    {
        return "STOP";
    }


    if (
        command == "STATUS"
    )
    {
        return "STATUS";
    }


    return "";
}


/* =========================================================
             READ FIREBASE STRING
   ========================================================= */

String readFirebaseString(
    const String &path)
{
    if (
        !firebaseAvailable()
    )
    {
        return "";
    }


    if (
        !Firebase.RTDB.getString(
            &fbdo,
            BASE_PATH + path
        )
    )
    {
        return "";
    }


    String value =
        fbdo.stringData();


    value.trim();


    return value;
}


/* =========================================================
                  SEND NEW COMMAND
   ========================================================= */

bool transmitCommand(
    const String &command,
    const String &id)
{
    if (
        !loraOK
    )
    {
        Serial.println(
            "[COMMAND] LoRa unavailable"
        );

        return false;
    }


    String packet =
        "CMD:" +
        command +
        "|ID:" +
        id;


    Serial.println();

    Serial.println(
        "========================================"
    );

    Serial.println(
        "         TRANSMITTING MOTOR COMMAND"
    );

    Serial.println(
        "========================================"
    );


    Serial.print(
        "Command : "
    );

    Serial.println(
        command
    );


    Serial.print(
        "ID      : "
    );

    Serial.println(
        id
    );


    Serial.print(
        "Packet  : "
    );

    Serial.println(
        packet
    );


    bool sent =
        sendLoRa(
            packet
        );


    if (sent)
    {
        activeCommand =
            command;


        activeCommandId =
            id;


        waitingAck =
            true;


        commandSendMillis =
            millis();


        commandRetryCount =
            0;


        writeMotorCommandStatus("sending", activeCommandId);


        pushLog(
            "Command sent: " +
            command
        );


        Serial.println(
            "[COMMAND] SENT - waiting for ACK"
        );


        Serial.println(
            "========================================"
        );


        return true;
    }


    Serial.println(
        "[COMMAND] LoRa transmission FAILED"
    );


    return false;
}


/* =========================================================
                  PROCESS FIREBASE COMMAND
   ========================================================= */

void processFirebaseCommand()
{
    if (
        millis() -
        lastCommandCheck <
        COMMAND_CHECK_INTERVAL
    )
    {
        return;
    }


    lastCommandCheck =
        millis();


    if (
        !firebaseAvailable()
    )
    {
        return;
    }


    /*
       Never start another command while
       waiting for current command ACK.
    */

    if (
        waitingAck ||
        waitingFieldStatus
    )
    {
        return;
    }


    /* =====================================================
                       READ COMMAND ID
       ===================================================== */

    String id =
        readFirebaseString(
            "/motor/command_id"
        );


    if (
        id.length() == 0
    )
    {
        return;
    }


    /* =====================================================
                     READ COMMAND
       ===================================================== */

    String rawCommand =
        readFirebaseString(
            "/motor/command"
        );


    if (
        rawCommand.length() == 0
    )
    {
        return;
    }


    String command =
        normalizeCommand(
            rawCommand
        );


    /* =====================================================
                       INVALID COMMAND
       ===================================================== */

    if (
        command.length() == 0
    )
    {
        Serial.print(
            "[COMMAND] INVALID: "
        );


        Serial.println(
            rawCommand
        );


        lastProcessedCommandId =
            id;


        writeMotorCommandStatus("invalid", id);


        pushLog(
            "Invalid motor command: " +
            rawCommand
        );


        return;
    }


    /* =====================================================
                       STATUS COMMAND
       ===================================================== */

    if (
        command == "STATUS"
    )
    {
        if (
            id !=
            lastProcessedCommandId
        )
        {
            lastProcessedCommandId =
                id;


            writeMotorCommandStatus("done", id);


            sendLoRa(
                "STATUS"
            );


            Serial.println(
                "[COMMAND] STATUS sent"
            );
        }


        return;
    }


    /* =====================================================
                   DETERMINE NEW COMMAND
       ===================================================== */

    bool newCommand =
        (
            id !=
            lastProcessedCommandId
        );


    /*
       Firebase may contain a command waiting
       from before Home ESP32 was restarted.

       Pending/queued/requested commands are
       therefore allowed to continue.
    */

    String commandStatus =
        readFirebaseString(
            "/motor/command_status"
        );


    commandStatus.toLowerCase();


    bool pendingCommand =
        (
            commandStatus == "pending" ||
            commandStatus == "queued" ||
            commandStatus == "requested"
        );


    /*
       If this is the same old completed/failed
       command and isn't explicitly pending,
       do not execute it again.
    */

    if (
        !newCommand &&
        !pendingCommand
    )
    {
        return;
    }


    /* =====================================================
                  PRINT COMMAND DETECTED
       ===================================================== */

    Serial.println();

    Serial.println(
        "******** NEW FIREBASE COMMAND ********"
    );


    Serial.print(
        "Firebase command : "
    );

    Serial.println(
        rawCommand
    );


    Serial.print(
        "Normalized       : "
    );

    Serial.println(
        command
    );


    Serial.print(
        "Command ID       : "
    );

    Serial.println(
        id
    );


    Serial.print(
        "Firebase status  : "
    );

    Serial.println(
        commandStatus
    );


    Serial.println(
        "***************************************"
    );


    /*
       Do NOT reject based on Field online flag.

       Actual LoRa TX + ACK determines whether
       the Field received the command.
    */

    if (
        transmitCommand(
            command,
            id
        )
    )
    {
        /*
           Mark command as processed only after
           the first LoRa transmission succeeds.

           The active command remains tracked until
           its ACK arrives.
        */

        lastProcessedCommandId =
            id;
    }

    else
    {
        writeMotorCommandStatus("failed", id);


        pushLog(
            "Command TX failed: " +
            command
        );


        Serial.println(
            "[COMMAND] TX FAILED"
        );
    }
}


/* =========================================================
                    COMMAND RETRY
   ========================================================= */

void handleCommandRetry()
{
    if (
        !waitingAck
    )
    {
        return;
    }


    if (
        millis() -
        commandSendMillis <
        ACK_TIMEOUT
    )
    {
        return;
    }


    /* =====================================================
                           RETRY
       ===================================================== */

    if (
        commandRetryCount <
        MAX_RETRY
    )
    {
        commandRetryCount++;


        /*
           IMPORTANT:

           Same command and SAME command ID.

           This prevents a retry from becoming
           a new logical motor command.
        */

        String packet =
            "CMD:" +
            activeCommand +
            "|ID:" +
            activeCommandId;


        Serial.println();

        Serial.print(
            "[COMMAND] RETRY "
        );


        Serial.print(
            commandRetryCount
        );


        Serial.print(
            "/"
        );


        Serial.println(
            MAX_RETRY
        );


        Serial.print(
            "[COMMAND] Same ID: "
        );


        Serial.println(
            activeCommandId
        );


        if (
            sendLoRa(
                packet
            )
        )
        {
            commandSendMillis =
                millis();


            writeMotorCommandStatus("sending", activeCommandId);
        }


        return;
    }


    /* =====================================================
                    ALL RETRIES FAILED
       ===================================================== */

    waitingAck =
        false;


    writeMotorCommandStatus("failed", activeCommandId);


    pushLog(
        "Command failed - no Field ACK: " +
        activeCommand
    );


    Serial.println();

    Serial.println(
        "!!!!!!!! COMMAND FAILED !!!!!!!!"
    );


    Serial.print(
        "Command : "
    );


    Serial.println(
        activeCommand
    );


    Serial.print(
        "ID      : "
    );


    Serial.println(
        activeCommandId
    );


    Serial.print(
        "Retries : "
    );


    Serial.println(
        MAX_RETRY
    );


    Serial.println(
        "Reason  : No ACK from Field ESP32"
    );


    Serial.println(
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    );


    activeCommand = "";

    activeCommandId = "";
}


/* =========================================================
                    HOME STATUS
   ========================================================= */

void updateHomeStatus()
{
    if (
        waitingFieldStatus
    )
    {
        return;
    }


    if (
        millis() -
        lastHomeStatus <
        HOME_STATUS_INTERVAL
    )
    {
        return;
    }


    lastHomeStatus =
        millis();


    bool wifiConnected =
        WiFi.status() ==
        WL_CONNECTED;


    firebaseString(
        "/status/home_esp32",
        "online"
    );


    firebaseString(
        "/status/home_wifi",
        wifiConnected
        ? "online"
        : "offline"
    );


    time_t now;


    if (
        getValidTime(now)
    )
    {
        firebaseInt(
            "/status/home_last_seen",
            (int)now
        );
    }
}


/* =========================================================
               REQUEST FIELD STATUS
   ========================================================= */

void requestFieldStatus()
{
    if (
        !loraOK
    )
    {
        return;
    }


    if (
        waitingAck ||
        waitingFieldStatus
    )
    {
        return;
    }


    /*
       NEVER interrupt a motor command.
    */

    if (
        millis() -
        lastStatusRequest <
        FIELD_STATUS_REQUEST
    )
    {
        return;
    }


    if (
        sendLoRa(
            "STATUS"
        )
    )
    {
        lastStatusRequest =
            millis();

        fieldStatusRequestMillis =
            millis();

        waitingFieldStatus = true;

        Serial.println(
            "[STATUS] Field STATUS requested"
        );
    }
}


/* =========================================================
              SERIAL STATUS DASHBOARD
   ========================================================= */

void printStatusSummary()
{
    if (
        millis() -
        lastSerialSummary <
        SERIAL_SUMMARY_INTERVAL
    )
    {
        return;
    }


    lastSerialSummary =
        millis();


    bool wifiOK =
        WiFi.status() ==
        WL_CONNECTED;


    bool firebaseOK =
        Firebase.ready();


    bool fieldOK =
        isFieldOnline();


    Serial.println();

    Serial.println(
        "================================================"
    );


    Serial.println(
        "              HOME ESP32 STATUS"
    );


    Serial.println(
        "================================================"
    );


    Serial.println(
        "Home ESP32       : ONLINE"
    );


    Serial.print(
        "WiFi             : "
    );


    Serial.println(
        wifiOK
        ? "CONNECTED"
        : "DISCONNECTED"
    );


    if (wifiOK)
    {
        Serial.print(
            "WiFi RSSI        : "
        );


        Serial.print(
            WiFi.RSSI()
        );


        Serial.println(
            " dBm"
        );


        Serial.print(
            "IP Address       : "
        );


        Serial.println(
            WiFi.localIP()
        );
    }


    Serial.print(
        "Firebase         : "
    );


    Serial.println(
        firebaseOK
        ? "READY"
        : "NOT READY"
    );


    Serial.print(
        "LoRa Hardware    : "
    );


    Serial.println(
        loraOK
        ? "READY"
        : "FAILED"
    );


    Serial.print(
        "Field ESP32      : "
    );


    Serial.println(
        fieldOK
        ? "ONLINE"
        : "OFFLINE"
    );


    Serial.println();


    Serial.println(
        "--------------- MOTOR ---------------"
    );


    Serial.print(
        "Motor Actual     : "
    );


    Serial.println(
        fieldMotor
    );


    Serial.print(
        "Current          : "
    );


    Serial.print(
        fieldCurrent,
        2
    );


    Serial.println(
        " A"
    );


    Serial.println();


    Serial.println(
        "---------------- PSR ----------------"
    );


    Serial.print(
        "PSR Status       : "
    );


    Serial.println(
        fieldPSR
        ? "OK"
        : "FAULT / OFF"
    );


    Serial.print(
        "PSR Raw          : "
    );


    Serial.println(
        fieldPSRRaw
    );


    Serial.println();


    Serial.println(
        "-------------- LoRa SIGNAL ------------"
    );


    Serial.print(
        "RSSI             : "
    );


    Serial.print(
        fieldRSSI
    );


    Serial.println(
        " dBm"
    );


    Serial.print(
        "SNR              : "
    );


    Serial.print(
        fieldSNR,
        2
    );


    Serial.println(
        " dB"
    );


    Serial.println();


    Serial.println(
        "------------- COMMAND ----------------"
    );


    Serial.print(
        "Active Command   : "
    );


    Serial.println(
        activeCommand.length()
        ? activeCommand
        : "NONE"
    );


    Serial.print(
        "Active ID        : "
    );


    Serial.println(
        activeCommandId.length()
        ? activeCommandId
        : "NONE"
    );


    Serial.print(
        "Last Processed   : "
    );


    Serial.println(
        lastProcessedCommandId.length()
        ? lastProcessedCommandId
        : "NONE"
    );


    Serial.print(
        "Command State    : "
    );


    Serial.println(
        waitingAck
        ? "WAITING ACK"
        : "IDLE"
    );


    Serial.print(
        "Retries          : "
    );


    Serial.println(
        commandRetryCount
    );


    Serial.print(
        "ACK Timeout      : "
    );


    Serial.print(
        ACK_TIMEOUT / 1000UL
    );


    Serial.println(
        " seconds"
    );


    Serial.print(
        "Max Retries      : "
    );


    Serial.println(
        MAX_RETRY
    );


    Serial.println(
        "================================================"
    );
}


/* =========================================================
                    WIFI CONNECTION
   ========================================================= */

void connectWiFi()
{
    WiFi.mode(
        WIFI_STA
    );


    WiFi.setAutoReconnect(
        true
    );


    WiFi.begin(
        WIFI_SSID,
        WIFI_PASSWORD
    );


    Serial.print(
        "Connecting to WiFi"
    );


    unsigned long start =
        millis();


    while (
        WiFi.status() !=
        WL_CONNECTED &&
        millis() -
        start < 20000UL
    )
    {
        delay(500);


        Serial.print(
            "."
        );
    }


    Serial.println();


    if (
        WiFi.status() ==
        WL_CONNECTED
    )
    {
        Serial.println(
            "WiFi CONNECTED"
        );


        Serial.print(
            "IP: "
        );


        Serial.println(
            WiFi.localIP()
        );


        Serial.print(
            "WiFi RSSI: "
        );


        Serial.print(
            WiFi.RSSI()
        );


        Serial.println(
            " dBm"
        );
    }

    else
    {
        Serial.println(
            "WiFi connection FAILED"
        );
    }
}


/* =========================================================
                 FIREBASE INITIALIZATION
   ========================================================= */

void setupFirebase()
{
    Serial.println(
        "Initializing Firebase..."
    );


    config.api_key =
        API_KEY;


    config.database_url =
        DATABASE_URL;


    config.signer.tokens.legacy_token =
        FIREBASE_LEGACY_TOKEN;


    Firebase.begin(
        &config,
        &auth
    );


    Firebase.reconnectWiFi(
        true
    );


    Serial.println(
        "Firebase initialized"
    );
}


/* =========================================================
                         TIME
   ========================================================= */

void setupTime()
{
    /*
       India:
       UTC +5:30
       19800 seconds
    */

    configTime(
        19800,
        0,
        "pool.ntp.org",
        "time.nist.gov"
    );


    Serial.println(
        "NTP synchronization started"
    );
}


/* =========================================================
                    LORA INITIALIZATION
   ========================================================= */

bool setupLoRa()
{
    Serial.println(
        "Starting LoRa..."
    );


    SPI.begin(
        LORA_SCK,
        LORA_MISO,
        LORA_MOSI,
        LORA_SS
    );


    LoRa.setPins(
        LORA_SS,
        LORA_RST,
        LORA_DIO0
    );


    if (
        !LoRa.begin(
            LORA_FREQ
        )
    )
    {
        Serial.println(
            "LoRa FAILED"
        );


        return false;
    }


    LoRa.setSpreadingFactor(
        LORA_SF
    );


    LoRa.setSignalBandwidth(
        LORA_BW
    );


    LoRa.setCodingRate4(
        LORA_CR
    );


    LoRa.setSyncWord(
        LORA_SYNC
    );


    LoRa.setTxPower(
        LORA_POWER
    );


    LoRa.receive();


    Serial.println(
        "LoRa READY"
    );


    Serial.print(
        "Frequency: "
    );


    Serial.print(
        LORA_FREQ / 1000000.0
    );


    Serial.println(
        " MHz"
    );


    Serial.print(
        "Spreading Factor: "
    );


    Serial.println(
        LORA_SF
    );


    Serial.print(
        "Bandwidth: "
    );


    Serial.print(
        LORA_BW / 1000.0
    );


    Serial.println(
        " kHz"
    );


    Serial.print(
        "TX Power: "
    );


    Serial.print(
        LORA_POWER
    );


    Serial.println(
        " dBm"
    );


    return true;
}


/* =========================================================
               INITIAL FIREBASE STATE
   ========================================================= */

void initializeFirebaseState()
{
    Serial.println(
        "Initializing Firebase state..."
    );


    unsigned long start =
        millis();


    while (
        !Firebase.ready() &&
        millis() -
        start < 15000UL
    )
    {
        Serial.println(
            "Waiting for Firebase authentication..."
        );


        delay(250);
    }


    if (
        !Firebase.ready()
    )
    {
        Serial.println(
            "Firebase NOT ready"
        );


        return;
    }


    if (
        WiFi.status() !=
        WL_CONNECTED
    )
    {
        Serial.println(
            "WiFi NOT connected"
        );


        return;
    }


    FirebaseJson json;


    /* =====================================================
                         STATUS
       ===================================================== */

    json.add(
        "status/home_esp32",
        "online"
    );


    json.add(
        "status/home_wifi",
        "online"
    );


    time_t now;


    if (
        getValidTime(now)
    )
    {
        json.add(
            "status/home_last_seen",
            (int)now
        );
    }


    /*
       Field starts offline until we receive
       actual communication.
    */

    json.add(
        "status/field_esp32",
        "offline"
    );


    json.add(
        "status/field_lora",
        "offline"
    );


    /* =====================================================
                         PHASE
       ===================================================== */

    json.add(
        "phase/type",
        "THREE_PHASE"
    );


    json.add(
        "phase/available",
        false
    );


    /*
       IMPORTANT:

       DO NOT overwrite:

       motor/command
       motor/command_id
       motor/actual
       motor/command_status
       timer fields

       The web application may already have
       a pending command.
    */


    /* =====================================================
                           PSR
       ===================================================== */

    json.add(
        "psr/ok",
        0
    );


    json.add(
        "psr/raw",
        0
    );


    /* =====================================================
                         UPDATE
       ===================================================== */

    Serial.println(
        "Sending initial Firebase state..."
    );


    bool result =
        Firebase.RTDB.updateNode(
            &fbdo,
            BASE_PATH,
            &json
        );


    if (result)
    {
        Serial.println(
            "Firebase initial state updated"
        );
    }

    else
    {
        Serial.print(
            "Firebase initial state ERROR: "
        );


        Serial.println(
            fbdo.errorReason()
        );
    }
}


/* =========================================================
                           SETUP
   ========================================================= */

void setup()
{
    Serial.begin(
        115200
    );


    delay(1000);


    Serial.println();


    Serial.println(
        "================================================"
    );


    Serial.println(
        "                HOME ESP32"
    );


    Serial.println(
        "           LoRa + WiFi + Firebase"
    );


    Serial.println(
        "================================================"
    );


    /* =====================================================
                           WIFI
       ===================================================== */

    connectWiFi();


    /* =====================================================
                           TIME
       ===================================================== */

    setupTime();


    /* =====================================================
                         FIREBASE
       ===================================================== */

    setupFirebase();


    /* =====================================================
                            LORA
       ===================================================== */

    loraOK =
        setupLoRa();


    if (!loraOK)
    {
        Serial.println();

        Serial.println(
            "WARNING: LoRa initialization failed"
        );
    }


    /* =====================================================
                     INITIAL STATE
       ===================================================== */

    initializeFirebaseState();


    /* =====================================================
                           READY
       ===================================================== */

    Serial.println();


    Serial.println(
        "================================================"
    );


    Serial.println(
        "              HOME ESP32 READY"
    );


    Serial.println(
        "================================================"
    );


    Serial.print(
        "WiFi             : "
    );


    Serial.println(
        WiFi.status() == WL_CONNECTED
        ? "READY"
        : "OFFLINE"
    );


    Serial.print(
        "Firebase         : "
    );


    Serial.println(
        Firebase.ready()
        ? "READY"
        : "WAITING"
    );


    Serial.print(
        "LoRa Hardware    : "
    );


    Serial.println(
        loraOK
        ? "READY"
        : "FAILED"
    );


    Serial.println(
        "Device           : farm001"
    );


    Serial.println(
        "Firebase Path    : devices/farm001"
    );


    Serial.println(
        "Phase            : THREE_PHASE"
    );


    Serial.println(
        "Current          : TOTAL MOTOR CURRENT"
    );


    Serial.println(
        "PSR              : ENABLED"
    );


    Serial.println(
        "Timer            : WEB APP CONTROLLED"
    );


    Serial.println(
        "Command System   : RELIABLE ACK MODE"
    );


    Serial.println(
        "ACK Timeout      : 10 seconds"
    );


    Serial.println(
        "Maximum Retries  : 6"
    );


    Serial.println(
        "Field ESP32      : WAITING"
    );


    Serial.println(
        "================================================"
    );


    /* =====================================================
                    INFORM FIELD
       ===================================================== */

    if (
        loraOK
    )
    {
        sendLoRa(
            "HOME_READY"
        );
    }
}


/* =========================================================
                           LOOP
   ========================================================= */

void loop()
{
    /* =====================================================
                       RECEIVE LORA
       ===================================================== */

    receiveLoRa();

    /*
       Process status-derived runtime/Firebase work only after
       LoRa RX has returned to the main loop.
    */
    if (runtimeUpdatePending)
    {
        runtimeUpdatePending = false;
        updateRuntime();
    }

    syncFieldStatusToFirebase();


    /*
       STATUS packets are long at SF12. Keep the processor in
       receive mode until the Field reply is parsed or expires.
    */

    if (
        waitingFieldStatus
    )
    {
        if (
            millis() -
            fieldStatusRequestMillis >=
            FIELD_STATUS_RESPONSE_TIMEOUT
        )
        {
            waitingFieldStatus = false;

            Serial.println(
                "[STATUS] Field STATUS response timed out"
            );
        }
        else
        {
            return;
        }
    }


    /* =====================================================
                    CHECK FIELD TIMEOUT
       ===================================================== */

    checkFieldTimeout();


    /* =====================================================
                  FIREBASE COMMAND
       ===================================================== */

    processFirebaseCommand();


    /* =====================================================
                     COMMAND RETRY
       ===================================================== */

    handleCommandRetry();


    /* =====================================================
                       HOME STATUS
       ===================================================== */

    updateHomeStatus();


    /* =====================================================
                  FIELD STATUS REQUEST
       ===================================================== */

    requestFieldStatus();


    /* =====================================================
                  SERIAL DASHBOARD
       ===================================================== */

    printStatusSummary();


    /* =====================================================
                     WIFI RECONNECT
       ===================================================== */

    if (
        WiFi.status() !=
        WL_CONNECTED
    )
    {
        if (
            millis() -
            lastWiFiRetry >=
            WIFI_RETRY_INTERVAL
        )
        {
            lastWiFiRetry =
                millis();


            Serial.println(
                "WiFi disconnected - reconnecting..."
            );


            WiFi.disconnect();


            WiFi.begin(
                WIFI_SSID,
                WIFI_PASSWORD
            );
        }
    }


    delay(10);
}
