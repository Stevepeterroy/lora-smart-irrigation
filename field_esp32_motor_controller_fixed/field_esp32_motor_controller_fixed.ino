#include <SPI.h>
#include <LoRa.h>
#include <math.h>
#include "esp_system.h"      // esp_reset_reason()
#include "esp_task_wdt.h"    // Task Watchdog Timer

/*
   =========================================================
                    FIELD ESP32
              REAL MOTOR CONTROLLER
   =========================================================

   HOME ESP32
        |
       LoRa
        |
   FIELD ESP32
        |
   ┌────┴───────────────┐
   │                    │
   PSR                  SCT
   GPIO 32              GPIO 34
   │                    │
   3-Phase              Motor Current
   Power                RMS
   │                    │
   └─────────┬──────────┘
             │
        Motor Actual
             │
            LoRa
             │
         HOME ESP32

   =========================================================
                    REAL SENSOR MODE
   =========================================================

   PSR:
       REAL GPIO INPUT

   SCT:
       REAL ADC INPUT

   MOTOR ACTUAL:
       Determined ONLY from SCT current.

   MOTOR COMMAND:
       Determined from START / STOP commands.

   IMPORTANT:

       MOTOR COMMAND != MOTOR ACTUAL

       Example:

       Command = ON
       SCT current = 0 A

       => Command: ON
       => Actual: OFF

       Command = OFF
       SCT current = 8 A

       => Command: OFF
       => Actual: ON

   =========================================================
        HARDWARE PROTECTION REQUIRED (READ THIS)
   =========================================================

   IMPORTANT: The reset problem you are seeing is caused by
   electrical events on the DOL contactor/relay side hitting
   the ESP32's power rail or GPIO/EN lines. Software CANNOT
   fully eliminate a brownout or EMI-induced reset by itself.
   This sketch adds diagnostics and a safe recovery routine,
   but the following hardware measures are strongly
   recommended and, in most field installations, REQUIRED:

     - Use a separate, adequately-rated, regulated power
       supply for the ESP32 (do not share a marginal 5V/3.3V
       rail with the relay coils).
     - Give the relay modules their own adequate 5V supply;
       do not let relay coil inrush sag the ESP32 supply.
     - Use a common low-voltage ground between ESP32 and
       relay modules where required by the relay board design.
     - Fit a flyback (reverse) diode across any DC contactor
       coil.
     - Fit a proper RC snubber or MOV across any AC contactor
       coil, rated for the coil voltage, to suppress the
       inductive spike when the contactor opens/closes.
     - Keep mains/contactor wiring physically separated and
       routed away from ESP32 wiring and antenna/LoRa wiring.
     - Add a bulk capacitor (e.g. 470-1000uF) plus a 0.1uF
       ceramic decoupling capacitor right at the ESP32's
       supply pins.
     - NEVER connect mains voltage directly to any ESP32 GPIO
       pin. Only the relay module's low-voltage control side
       should ever touch a GPIO.

   Skipping these will mean the ESP32 keeps resetting no
   matter how good the firmware is.

   =========================================================
                      PIN CONFIGURATION
   =========================================================
*/

#define SCT_PIN        34
#define PSR_PIN        32

#define RELAY_START    33
#define RELAY_STOP     27


/* =========================================================
                       RELAY LOGIC
   ========================================================= */

#define RELAY_ON_LEVEL   LOW
#define RELAY_OFF_LEVEL  HIGH


/* =========================================================
                       PSR LOGIC
   =========================================================

   Change ONLY this if your PSR relay output is active LOW.

       HIGH = PSR ON
       LOW  = PSR OFF

   ========================================================= */

#define PSR_ON_LEVEL LOW


/* =========================================================
                    SCT CONFIGURATION
   =========================================================

   GPIO 34 is ADC1 and is suitable for analog input.

   The SCT interface output must NEVER exceed the ESP32
   ADC input voltage range.

   The code measures AC RMS voltage around the ADC midpoint.

   CURRENT_CALIBRATION:

       Current = RMS voltage * CURRENT_CALIBRATION

   YOU MUST CALIBRATE THIS VALUE for your exact SCT
   sensor/interface/burden resistor.

   Examples:

       SCT-013-000 + 22 ohm burden:
       approximately 90.9 A/V

       SCT-013-030 voltage-output:
       approximately 30 A/V

   Do NOT blindly use either value unless it matches
   your actual SCT hardware.

   Start with the value appropriate for your hardware
   and calibrate using a known current.

   ========================================================= */

#define CURRENT_CALIBRATION_A_PER_V   90.91f


/* =========================================================
                    MOTOR DETECTION
   =========================================================

   Motor state uses two thresholds so small SCT/ADC variations
   cannot repeatedly switch the reported motor state.

   This should be comfortably above the no-load/noise
   current of the SCT interface.

   Example:

       observed OFF noise = up to 1.23 A
       ON threshold        = 2.00 A
       OFF threshold       = 1.00 A

   Calibrate both thresholds against the installed motor. The ON
   threshold must be above the largest confirmed OFF reading and
   below the smallest confirmed running-current reading.

   ========================================================= */

#define MOTOR_ON_CURRENT_THRESHOLD     4.0f
#define MOTOR_OFF_CURRENT_THRESHOLD    3.00f
#define MOTOR_STATE_CONFIRMATIONS      2
#define SCT_FILTER_ALPHA               0.35f


/* =========================================================
                  SCT SAMPLING CONFIGURATION
   ========================================================= */

#define SCT_SAMPLE_WINDOW_MS          500UL

#define ADC_REFERENCE_VOLTAGE         3.3f

#define ADC_MAX_VALUE                 4095.0f


/* =========================================================
                    LORA PINS
   ========================================================= */

#define LORA_SS        5
#define LORA_RST       14
#define LORA_DIO0      26

#define LORA_SCK       18
#define LORA_MISO      19
#define LORA_MOSI      23


/* =========================================================
                    LORA SETTINGS
   ========================================================= */

#define LORA_FREQ      433E6

#define LORA_SF        12
#define LORA_BW        125E3
#define LORA_CR        5
#define LORA_SYNC      0x34
#define LORA_POWER     20


/* =========================================================
              WATCHDOG CONFIGURATION
   =========================================================

   Timeout is set well above the worst-case blocking time
   of a single command (SCT sampling window + relay pulse +
   guard delays + status transmission ≈ 2.5s), so normal
   SCT sampling and LoRa operation is never disturbed.
   If the main loop genuinely hangs (real crash/lockup)
   for longer than this, the watchdog will reset the ESP32
   and esp_reset_reason() will report it on next boot.
   ========================================================= */

#define WATCHDOG_TIMEOUT_SECONDS   8


/* =========================================================
                  COMMAND MEMORY
   ========================================================= */

String lastCommandID = "";
String lastCommand = "";


/* =========================================================
                    MOTOR COMMAND STATE
   =========================================================

   This represents what the controller was commanded
   to do.

   It does NOT represent actual motor operation.

   Actual motor state comes from SCT.
   ========================================================= */

String motorCommand = "OFF";


/* =========================================================
                    SENSOR VALUES
   ========================================================= */

float motorCurrent = 0.0f;

float rawMotorCurrent = 0.0f;

float sctRMSVoltage = 0.0f;

String motorActual = "OFF";

bool motorCurrentFilterReady = false;

uint8_t motorOnConfirmations = 0;

uint8_t motorOffConfirmations = 0;

int psrRaw = 0;

String psrState = "OFF";


/* =========================================================
                     LORA SIGNAL
   ========================================================= */

int lastRSSI = 0;

float lastSNR = 0.0;


/* =========================================================
                    STATUS TIMER
   ========================================================= */



/* =========================================================
                    RELAY TIMING
   ========================================================= */

#define RELAY_PULSE_TIME  500UL
#define RELAY_GUARD_TIME 150UL


bool relayOperationActive = false;


/* =========================================================
        RESET DIAGNOSTICS (esp_reset_reason)
   =========================================================

   Prints WHY the ESP32 last restarted. This does NOT
   prevent resets - it only reports the cause so field
   resets (brownout / watchdog / panic / EMI-induced
   external reset) can be told apart from a normal
   power-on.

   Requires ESP32 Arduino core >= 2.0.0. If your core is
   older than that and this enum is not found, upgrade the
   ESP32 board package via Boards Manager - numeric reset
   codes are printed as well as a fallback reference.
   ========================================================= */

void printResetReason()
{
    esp_reset_reason_t reason = esp_reset_reason();

    Serial.println();
    Serial.println("========== ESP32 RESET REASON ==========");

    switch (reason)
    {
        case ESP_RST_POWERON:
            Serial.println("Cause: Power-on reset");
            break;

        case ESP_RST_EXT:
            Serial.println("Cause: External / reset-button reset");
            break;

        case ESP_RST_SW:
            Serial.println("Cause: Software reset (esp_restart)");
            break;

        case ESP_RST_PANIC:
            Serial.println("Cause: Panic / crash reset");
            break;

        case ESP_RST_INT_WDT:
        case ESP_RST_TASK_WDT:
        case ESP_RST_WDT:
            Serial.println("Cause: Watchdog reset");
            break;

        case ESP_RST_BROWNOUT:
            Serial.println("Cause: Brownout reset (supply voltage dropped too low)");
            break;

        case ESP_RST_DEEPSLEEP:
            Serial.println("Cause: Wake from deep sleep");
            break;

        case ESP_RST_SDIO:
            Serial.println("Cause: SDIO reset");
            break;

        case ESP_RST_UNKNOWN:
        default:
            Serial.println("Cause: Unknown reset");
            break;
    }

    Serial.print("Raw reset code (numeric): ");
    Serial.println((int)reason);

    Serial.println("=========================================");
}


/* =========================================================
        BOOT-TIME RELAY SAFETY (RUNS ABSOLUTELY FIRST)
   =========================================================

   This MUST run before Serial, before LoRa/SPI, before
   anything else, on every single boot - power-on, button
   reset, brownout reset, watchdog reset, panic reset, all
   of them.

   Relays are active LOW, so the safe/OFF level is HIGH.
   pinMode() is immediately followed by digitalWrite(HIGH)
   with nothing in between, to minimize any window where
   the pin could float into RELAY_ON_LEVEL.
   ========================================================= */

void forceRelayPinsSafeAtBoot()
{
    pinMode(RELAY_START, OUTPUT);
    digitalWrite(RELAY_START, RELAY_OFF_LEVEL);

    pinMode(RELAY_STOP, OUTPUT);
    digitalWrite(RELAY_STOP, RELAY_OFF_LEVEL);
}


/* =========================================================
        FULL STATE RESET AFTER ANY BOOT / RESET
   =========================================================

   Wipes every piece of state that could otherwise make the
   controller "remember" the pre-reset motor command and
   re-energize the START relay on its own.

   The previous motor command is NEVER restored and the
   motor is NEVER auto-started after a reset. A fresh LoRa
   START command is always required after any reboot.
   ========================================================= */

void resetControllerStateAfterBoot()
{
    allRelaysOff();
    relayOperationActive = false;

    motorCommand = "OFF";
    motorActual  = "OFF";

    motorCurrent            = 0.0f;
    rawMotorCurrent         = 0.0f;
    sctRMSVoltage           = 0.0f;
    motorCurrentFilterReady = false;

    motorOnConfirmations  = 0;
    motorOffConfirmations = 0;

    lastCommandID = "";
    lastCommand   = "";

    Serial.println();
    Serial.println("========== BOOT SAFETY RECOVERY ==========");
    Serial.println("Relays forced OFF (GPIO33=HIGH, GPIO27=HIGH)");
    Serial.println("motorCommand  -> OFF");
    Serial.println("motorActual   -> OFF");
    Serial.println("Confirmation counters cleared");
    Serial.println("Previous command NOT restored.");
    Serial.println("Motor stays OFF until a new START command is received.");
    Serial.println("===========================================");
}


/* =========================================================
                       RELAY SAFETY
   ========================================================= */

void allRelaysOff()
{
    digitalWrite(
        RELAY_START,
        RELAY_OFF_LEVEL
    );

    digitalWrite(
        RELAY_STOP,
        RELAY_OFF_LEVEL
    );
}


/* =========================================================
                 RELAY STATE
   ========================================================= */

bool isStartRelayOn()
{
    return (
        digitalRead(RELAY_START)
        ==
        RELAY_ON_LEVEL
    );
}


bool isStopRelayOn()
{
    return (
        digitalRead(RELAY_STOP)
        ==
        RELAY_ON_LEVEL
    );
}


/* =========================================================
                 RELAY GPIO DEBUG
   ========================================================= */

void printRelayGPIOState()
{
    Serial.println();

    Serial.println(
        "========== RELAY GPIO STATE =========="
    );

    Serial.print(
        "GPIO 33 START = "
    );

    Serial.println(
        digitalRead(RELAY_START) == HIGH
        ? "HIGH"
        : "LOW"
    );

    Serial.print(
        "GPIO 27 STOP  = "
    );

    Serial.println(
        digitalRead(RELAY_STOP) == HIGH
        ? "HIGH"
        : "LOW"
    );

    Serial.println(
        "======================================"
    );
}


/* =========================================================
                    RELAY SAFETY
   ========================================================= */

void checkRelaySafety()
{
    if (relayOperationActive)
    {
        return;
    }

    bool startOn =
        isStartRelayOn();

    bool stopOn =
        isStopRelayOn();

    if (
        startOn &&
        stopOn
    )
    {
        Serial.println(
            "SAFETY: START + STOP both ON"
        );

        allRelaysOff();
    }
}


/* =========================================================
                    READ PSR
   =========================================================

   REAL PSR INPUT

   GPIO 32 is read directly.

   ========================================================= */

void readPSR()
{
    psrRaw =
        digitalRead(PSR_PIN);

    if (
        psrRaw ==
        PSR_ON_LEVEL
    )
    {
        psrState = "ON";
    }
    else
    {
        psrState = "OFF";
    }
}


/* =========================================================
                  READ SCT CURRENT
   =========================================================

   REAL SCT RMS MEASUREMENT

   The ADC waveform is sampled around its DC midpoint.

   RMS AC voltage:

       sqrt(mean((sample - mean)^2))

   Current:

       RMS voltage × calibration factor

   ========================================================= */

float readSCTCurrent()
{
    unsigned long startTime =
        millis();

    double sum = 0.0;

    double sumSquares = 0.0;

    unsigned long sampleCount = 0;

    unsigned long lastFeedTime = startTime;


    while (
        millis() - startTime <
        SCT_SAMPLE_WINDOW_MS
    )
    {
        int raw =
            analogRead(SCT_PIN);

        sum += raw;

        sumSquares +=
            ((double)raw * (double)raw);

        sampleCount++;

        /*
           Feed the watchdog periodically during this
           blocking sampling window so a longer-than-usual
           SCT_SAMPLE_WINDOW_MS (if ever increased) never
           trips the watchdog by itself.
        */
        if (millis() - lastFeedTime >= 100UL)
        {
            esp_task_wdt_reset();
            lastFeedTime = millis();
        }
    }


    if (
        sampleCount < 10
    )
    {
        return 0.0f;
    }


    /*
       Calculate mean ADC value.
    */

    double mean =
        sum /
        sampleCount;


    /*
       Calculate variance.

       variance =
       E[x²] - E[x]²
    */

    double meanSquare =
        sumSquares /
        sampleCount;

    double variance =
        meanSquare -
        (mean * mean);


    if (
        variance < 0
    )
    {
        variance = 0;
    }


    /*
       ADC RMS counts.
    */

    double rmsCounts =
        sqrt(variance);


    /*
       Convert ADC counts to volts.
    */

    float rmsVoltage =
        (
            rmsCounts /
            ADC_MAX_VALUE
        )
        *
        ADC_REFERENCE_VOLTAGE;


    sctRMSVoltage =
        rmsVoltage;


    /*
       Convert voltage to current.
    */

    float current =
        rmsVoltage *
        CURRENT_CALIBRATION_A_PER_V;


    /*
       Remove tiny ADC noise.
    */

    if (
        current < 0.05f
    )
    {
        current = 0.0f;
    }


    return current;
}


/* =========================================================
                UPDATE MOTOR ACTUAL
   =========================================================

   THIS IS THE IMPORTANT PART.

   Motor Actual is NOT taken from relay state.

   Motor Actual is determined by real SCT current.

   ========================================================= */

void updateMotorActual()
{
    rawMotorCurrent =
        readSCTCurrent();


    if (!motorCurrentFilterReady)
    {
        motorCurrent = rawMotorCurrent;

        motorCurrentFilterReady = true;
    }
    else
    {
        motorCurrent =
            (SCT_FILTER_ALPHA * rawMotorCurrent) +
            ((1.0f - SCT_FILTER_ALPHA) * motorCurrent);
    }


    if (motorActual == "ON")
    {
        if (
            motorCurrent <=
            MOTOR_OFF_CURRENT_THRESHOLD
        )
        {
            motorOffConfirmations++;

            motorOnConfirmations = 0;

            if (
                motorOffConfirmations >=
                MOTOR_STATE_CONFIRMATIONS
            )
            {
                motorActual = "OFF";

                motorOffConfirmations = 0;
            }
        }
        else
        {
            motorOffConfirmations = 0;
        }
    }
    else if (
        motorCurrent >=
        MOTOR_ON_CURRENT_THRESHOLD
    )
    {
        motorOnConfirmations++;

        motorOffConfirmations = 0;

        if (
            motorOnConfirmations >=
            MOTOR_STATE_CONFIRMATIONS
        )
        {
            motorActual = "ON";

            motorOnConfirmations = 0;
        }
    }
    else
    {
        motorOnConfirmations = 0;

        motorOffConfirmations = 0;
    }


    Serial.println();

    Serial.println(
        "========== REAL MOTOR SENSOR =========="
    );

    Serial.print(
        "SCT Raw Current : "
    );

    Serial.print(
        rawMotorCurrent,
        2
    );

    Serial.println(
        " A"
    );

    Serial.print(
        "SCT RMS Voltage : "
    );

    Serial.print(
        sctRMSVoltage,
        5
    );

    Serial.println(
        " V"
    );

    Serial.print(
        "SCT Current     : "
    );

    Serial.print(
        motorCurrent,
        2
    );

    Serial.println(
        " A"
    );

    Serial.print(
        "Motor ON Threshold : "
    );

    Serial.print(
        MOTOR_ON_CURRENT_THRESHOLD,
        2
    );

    Serial.println(
        " A"
    );

    Serial.print(
        "Motor OFF Threshold: "
    );

    Serial.print(
        MOTOR_OFF_CURRENT_THRESHOLD,
        2
    );

    Serial.println(
        " A"
    );

    Serial.print(
        "Motor Actual    : "
    );

    Serial.println(
        motorActual
    );

    Serial.println(
        "========================================"
    );
}


/* =========================================================
                 PULSE START RELAY
   ========================================================= */

bool pulseStartRelay()
{
    relayOperationActive = true;


    Serial.println();
    Serial.println(
        "PHYSICAL START RELAY PULSE"
    );


    /*
       STOP must be OFF.
    */

    digitalWrite(
        RELAY_STOP,
        RELAY_OFF_LEVEL
    );

    delay(
        RELAY_GUARD_TIME
    );


    /*
       START OFF first.
    */

    digitalWrite(
        RELAY_START,
        RELAY_OFF_LEVEL
    );

    delay(50);


    /*
       START ON.
    */

    Serial.println(
        "GPIO 33 -> ON"
    );

    digitalWrite(
        RELAY_START,
        RELAY_ON_LEVEL
    );


    delay(
        RELAY_PULSE_TIME
    );

    /*
       Feed watchdog after the pulse delay - this is an
       expected, bounded blocking period, not a hang.
    */
    esp_task_wdt_reset();


    /*
       START OFF.
    */

    Serial.println(
        "GPIO 33 -> OFF"
    );

    digitalWrite(
        RELAY_START,
        RELAY_OFF_LEVEL
    );


    /*
       "finally" style guarantee: no matter what happened
       above, both relays end up OFF and the operation flag
       is cleared before this function returns.
    */
    allRelaysOff();

    relayOperationActive = false;


    printRelayGPIOState();

    return true;
}


/* =========================================================
                  PULSE STOP RELAY
   ========================================================= */

bool pulseStopRelay()
{
    relayOperationActive = true;


    Serial.println();
    Serial.println(
        "PHYSICAL STOP RELAY PULSE"
    );


    /*
       START must be OFF.
    */

    digitalWrite(
        RELAY_START,
        RELAY_OFF_LEVEL
    );

    delay(
        RELAY_GUARD_TIME
    );


    /*
       STOP OFF first.
    */

    digitalWrite(
        RELAY_STOP,
        RELAY_OFF_LEVEL
    );

    delay(50);


    /*
       STOP ON.
    */

    Serial.println(
        "GPIO 27 -> ON"
    );

    digitalWrite(
        RELAY_STOP,
        RELAY_ON_LEVEL
    );


    delay(
        RELAY_PULSE_TIME
    );

    /*
       Feed watchdog after the pulse delay - this is an
       expected, bounded blocking period, not a hang.
    */
    esp_task_wdt_reset();


    /*
       STOP OFF.
    */

    Serial.println(
        "GPIO 27 -> OFF"
    );

    digitalWrite(
        RELAY_STOP,
        RELAY_OFF_LEVEL
    );


    /*
       "finally" style guarantee: no matter what happened
       above, both relays end up OFF and the operation flag
       is cleared before this function returns.
    */
    allRelaysOff();

    relayOperationActive = false;


    printRelayGPIOState();

    return true;
}


/* =========================================================
                    MOTOR START
   ========================================================= */

bool motorStart()
{
    /*
       Read real PSR before starting.
    */

    readPSR();


    Serial.println();

    Serial.println(
        "========== MOTOR START =========="
    );

    Serial.print(
        "Real PSR: "
    );

    Serial.println(
        psrState
    );


    /*
       Do not start if 3-phase PSR is OFF.
    */

    if (
        psrState != "ON"
    )
    {
        Serial.println(
            "START BLOCKED: PSR OFF"
        );

        allRelaysOff();

        return false;
    }


    /*
       Physical START pulse.
    */

    if (
        !pulseStartRelay()
    )
    {
        allRelaysOff();

        return false;
    }


    /*
       Command state becomes ON.

       This does NOT mean motor is physically ON.

       SCT will determine actual state.
    */

    motorCommand = "ON";


    /*
       Give motor some time to start before
       measuring actual current.
    */

    delay(500);


    updateMotorActual();


    Serial.print(
        "Motor Command : "
    );

    Serial.println(
        motorCommand
    );

    Serial.print(
        "Motor Actual  : "
    );

    Serial.println(
        motorActual
    );


    return true;
}


/* =========================================================
                     MOTOR STOP
   ========================================================= */

bool motorStop()
{
    Serial.println();

    Serial.println(
        "========== MOTOR STOP =========="
    );


    /*
       Physical STOP pulse.

       We intentionally do NOT check motorActual
       before pulsing.

       Every NEW STOP command must physically execute.
    */

    if (
        !pulseStopRelay()
    )
    {
        allRelaysOff();

        return false;
    }


    /*
       Command state becomes OFF.
    */

    motorCommand = "OFF";


    /*
       Wait briefly for current to disappear.
    */

    delay(500);


    /*
       Read actual motor state from SCT.
    */

    updateMotorActual();


    Serial.print(
        "Motor Command : "
    );

    Serial.println(
        motorCommand
    );

    Serial.print(
        "Motor Actual  : "
    );

    Serial.println(
        motorActual
    );


    return true;
}


/* =========================================================
                       SEND LORA
   ========================================================= */

bool sendLoRa(
    const String &message
)
{
    Serial.print(
        "LoRa TX -> "
    );

    Serial.println(
        message
    );


    LoRa.idle();

    delay(5);


    if (
        LoRa.beginPacket() == 0
    )
    {
        LoRa.receive();

        return false;
    }


    LoRa.print(
        message
    );


    int result =
        LoRa.endPacket();


    LoRa.receive();


    if (
        result == 0
    )
    {
        return false;
    }


    return true;
}


/* =========================================================
                     SEND STATUS
   ========================================================= */

bool sendStatus()
{
    /*
       Refresh REAL sensors before transmission.
    */

    readPSR();

    updateMotorActual();


    /*
       IMPORTANT:

       MOTOR       = actual motor state

       COMMAND     = requested motor state

       CURRENT     = real SCT current

       PSR         = real PSR
    */

    String status =
        "STATUS"
        "|CURRENT:" +
        String(
            motorCurrent,
            2
        )

        + "|PSR:" +
        psrState

        + "|PSR_RAW:" +
        String(
            psrRaw
        )

        + "|MOTOR:" +
        motorActual

        + "|COMMAND:" +
        motorCommand

        + "|RSSI:" +
        String(
            lastRSSI
        )

        + "|SNR:" +
        String(
            lastSNR,
            2
        );


    bool sent =
        sendLoRa(
            status
        );


    Serial.println();

    Serial.println(
        "========== FIELD STATUS =========="
    );

    Serial.print(
        "PSR          : "
    );

    Serial.println(
        psrState
    );

    Serial.print(
        "PSR RAW      : "
    );

    Serial.println(
        psrRaw
    );

    Serial.print(
        "Current      : "
    );

    Serial.print(
        motorCurrent,
        2
    );

    Serial.println(
        " A"
    );

    Serial.print(
        "Motor Command: "
    );

    Serial.println(
        motorCommand
    );

    Serial.print(
        "Motor Actual : "
    );

    Serial.println(
        motorActual
    );

    Serial.print(
        "LoRa RSSI    : "
    );

    Serial.println(
        lastRSSI
    );

    Serial.print(
        "LoRa SNR     : "
    );

    Serial.println(
        lastSNR,
        2
    );

    Serial.print(
        "TX           : "
    );

    Serial.println(
        sent
        ? "SUCCESS"
        : "FAILED"
    );

    Serial.println(
        "=================================="
    );


    return sent;
}


/* =========================================================
                       SEND ACK
   ========================================================= */

bool sendACK(
    const String &commandID
)
{
    return sendLoRa(
        "ACK:" +
        commandID
    );
}


/* =========================================================
                    PROCESS COMMAND
   ========================================================= */

void processCommand(
    const String &msg
)
{
    /*
       Expected:

       CMD:START|ID:ABC

       CMD:STOP|ID:ABC

       CMD:STATUS|ID:ABC
    */

    /*
       Feed the watchdog at the start of command processing.
       A single command (pulse + SCT sampling + status TX)
       can take up to ~2.5s of blocking work; this keeps a
       full watchdog budget available for it.
    */
    esp_task_wdt_reset();


    int separator =
        msg.indexOf(
            "|ID:"
        );


    if (
        separator < 0
    )
    {
        Serial.println(
            "ERROR: Missing command ID"
        );

        return;
    }


    String command =
        msg.substring(
            4,
            separator
        );


    String commandID =
        msg.substring(
            separator + 4
        );


    command.trim();

    commandID.trim();

    command.toUpperCase();


    if (
        commandID.length() == 0
    )
    {
        return;
    }


    /*
       Duplicate protection.

       Only duplicate ID is blocked.

       Motor state is NOT used to skip commands.
    */

    if (
        commandID ==
        lastCommandID
    )
    {
        Serial.println(
            "Duplicate command ID - ignored"
        );

        sendACK(
            commandID
        );

        delay(100);

        sendStatus();

        return;
    }


    /* =====================================================
                         START
       ===================================================== */

    if (
        command ==
        "START"
    )
    {
        /*
           Save ID before execution.
        */

        lastCommandID =
            commandID;

        lastCommand =
            command;


        bool success =
            motorStart();


        if (
            success
        )
        {
            delay(100);

            sendACK(
                commandID
            );

            delay(100);

            sendStatus();
        }
        else
        {
            delay(100);

            sendStatus();
        }


        return;
    }


    /* =====================================================
                          STOP
       ===================================================== */

    if (
        command ==
        "STOP"
    )
    {
        lastCommandID =
            commandID;

        lastCommand =
            command;


        bool success =
            motorStop();


        if (
            success
        )
        {
            delay(100);

            sendACK(
                commandID
            );

            delay(100);

            sendStatus();
        }
        else
        {
            delay(100);

            sendStatus();
        }


        return;
    }


    /* =====================================================
                         STATUS
       ===================================================== */

    if (
        command ==
        "STATUS"
    )
    {
        lastCommandID =
            commandID;

        lastCommand =
            command;


        sendStatus();

        delay(100);

        sendACK(
            commandID
        );

        return;
    }


    Serial.print(
        "UNKNOWN COMMAND: "
    );

    Serial.println(
        command
    );
}


/* =========================================================
                  PROCESS LORA PACKET
   ========================================================= */

void processLoRaPacket()
{
    int packetSize =
        LoRa.parsePacket();


    if (
        packetSize <= 0
    )
    {
        return;
    }


    String msg = "";


    while (
        LoRa.available()
    )
    {
        msg +=
            (char)LoRa.read();
    }


    msg.trim();


    lastRSSI =
        LoRa.packetRssi();

    lastSNR =
        LoRa.packetSnr();


    Serial.println();

    Serial.println(
        "========== LoRa RX =========="
    );

    Serial.print(
        "Message: "
    );

    Serial.println(
        msg
    );

    Serial.print(
        "RSSI: "
    );

    Serial.println(
        lastRSSI
    );

    Serial.print(
        "SNR: "
    );

    Serial.println(
        lastSNR,
        2
    );


    /* =====================================================
                       HOME READY
       ===================================================== */

    if (
        msg ==
        "HOME_READY"
    )
    {
        sendLoRa(
            "FIELD_READY"
        );

        delay(100);

        sendStatus();

        return;
    }


    /* =====================================================
                         STATUS
       ===================================================== */

    if (
        msg ==
        "STATUS"
    )
    {
        sendStatus();

        return;
    }


    /* =====================================================
                         COMMAND
       ===================================================== */

    if (
        msg.startsWith(
            "CMD:"
        )
    )
    {
        processCommand(
            msg
        );

        return;
    }
}


/* =========================================================
                  PERIODIC STATUS
   =========================================================

   Home ESP32 is the LoRa master.
   Field does NOT transmit unsolicited periodic STATUS packets.

   STATUS is sent only when:
     - Home sends STATUS
     - Home sends HOME_READY
     - a valid START/STOP command is processed

   This keeps the LoRa channel deterministic and avoids collisions.
   ========================================================= */

void periodicStatus()
{
    // Intentionally disabled.
}


/* =========================================================
                         SETUP
   ========================================================= */

void setup()
{
    /*
       ABSOLUTE FIRST ACTION ON ANY BOOT/RESET.

       Runs before Serial, before SPI, before LoRa.
       Guarantees GPIO33/GPIO27 go to the safe (relay OFF)
       level as early as physically possible, regardless of
       what caused this boot (power-on, reset button,
       brownout, watchdog, panic).
    */
    forceRelayPinsSafeAtBoot();


    Serial.begin(
        115200
    );


    delay(1000);


    Serial.println();
    Serial.println(
        "================================================"
    );

    Serial.println(
        "             FIELD ESP32"
    );

    Serial.println(
        "           REAL MOTOR CONTROLLER"
    );

    Serial.println(
        "================================================"
    );


    /*
       Report WHY this boot happened (power-on, reset
       button, brownout, watchdog, panic, unknown, etc.)
    */
    printResetReason();


    /*
       Wipe all motor/relay/command state so nothing from
       before this reset can cause an automatic restart.
    */
    resetControllerStateAfterBoot();


    /* =====================================================
                          RELAYS
       ===================================================== */

    pinMode(
        RELAY_START,
        OUTPUT
    );

    pinMode(
        RELAY_STOP,
        OUTPUT
    );


    allRelaysOff();


    /* =====================================================
                           PSR
       ===================================================== */

    pinMode(
        PSR_PIN,
        INPUT
    );


    /* =====================================================
                           SCT
       ===================================================== */

    pinMode(
        SCT_PIN,
        INPUT
    );


    /*
       ESP32 ADC configuration.
    */

    analogReadResolution(
        12
    );


    analogSetPinAttenuation(
        SCT_PIN,
        ADC_11db
    );


    /* =====================================================
                     INITIAL SENSOR READ
       ===================================================== */

    readPSR();


    Serial.println();

    Serial.println(
        "========== REAL SENSOR CONFIG =========="
    );

    Serial.println(
        "PSR GPIO        : 32"
    );

    Serial.print(
        "PSR ON level    : "
    );

    Serial.println(
        PSR_ON_LEVEL == HIGH
        ? "HIGH"
        : "LOW"
    );

    Serial.println(
        "SCT GPIO        : 34"
    );

    Serial.print(
        "Current cal     : "
    );

    Serial.print(
        CURRENT_CALIBRATION_A_PER_V,
        3
    );

    Serial.println(
        " A/V"
    );

    Serial.print(
        "Motor ON threshold : "
    );

    Serial.print(
        MOTOR_ON_CURRENT_THRESHOLD,
        2
    );

    Serial.println(
        " A"
    );

    Serial.print(
        "Motor OFF threshold: "
    );

    Serial.print(
        MOTOR_OFF_CURRENT_THRESHOLD,
        2
    );

    Serial.println(
        " A"
    );

    Serial.println(
        "Fake current    : DISABLED"
    );

    Serial.println(
        "Fake PSR        : DISABLED"
    );

    Serial.println(
        "========================================="
    );


    /* =====================================================
                           SPI
       ===================================================== */

    SPI.begin(
        LORA_SCK,
        LORA_MISO,
        LORA_MOSI,
        LORA_SS
    );


    /* =====================================================
                           LORA
       ===================================================== */

    LoRa.setPins(
        LORA_SS,
        LORA_RST,
        LORA_DIO0
    );


    Serial.println(
        "Starting LoRa..."
    );


    if (
        !LoRa.begin(
            LORA_FREQ
        )
    )
    {
        Serial.println(
            "LoRa initialization FAILED"
        );

        allRelaysOff();


        while (true)
        {
            allRelaysOff();

            delay(1000);
        }
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


    /*
       Confirm both relays are OFF before entering LoRa
       receive mode.
    */
    allRelaysOff();

    LoRa.receive();


    /* =====================================================
              WATCHDOG (does not affect SCT/LoRa)
       =====================================================

       Timeout is set to WATCHDOG_TIMEOUT_SECONDS, comfortably
       above the worst-case blocking time of one command
       (~2.5s). Two API shapes are supported depending on
       your installed ESP32 Arduino core version.
       ===================================================== */

    #if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)

        esp_task_wdt_config_t twdtConfig = {
            .timeout_ms = WATCHDOG_TIMEOUT_SECONDS * 1000,
            .idle_core_mask = 0,
            .trigger_panic = true
        };

        esp_task_wdt_init(&twdtConfig);
        esp_task_wdt_add(NULL);

    #else

        esp_task_wdt_init(
            WATCHDOG_TIMEOUT_SECONDS,
            true
        );

        esp_task_wdt_add(NULL);

    #endif

    Serial.print(
        "Watchdog armed, timeout = "
    );
    Serial.print(
        WATCHDOG_TIMEOUT_SECONDS
    );
    Serial.println(
        " s"
    );


    /* =====================================================
                          INITIAL STATE
       ===================================================== */

    motorCommand =
        "OFF";

    motorActual =
        "OFF";

    lastCommandID =
        "";

    lastCommand =
        "";


    /* =====================================================
                         READY
       ===================================================== */

    Serial.println();

    Serial.println(
        "================================================"
    );

    Serial.println(
        "          FIELD ESP32 READY"
    );

    Serial.println(
        "================================================"
    );

    Serial.println(
        "REAL PSR        : ENABLED"
    );

    Serial.println(
        "REAL SCT        : ENABLED"
    );

    Serial.println(
        "Fake PSR        : DISABLED"
    );

    Serial.println(
        "Fake current    : DISABLED"
    );

    Serial.println(
        "Motor actual    : SCT based"
    );

    Serial.println(
        "Motor command   : LoRa command based"
    );

    Serial.println(
        "START GPIO      : 33"
    );

    Serial.println(
        "STOP GPIO       : 27"
    );

    Serial.println(
        "PSR GPIO        : 32"
    );

    Serial.println(
        "SCT GPIO        : 34"
    );

    Serial.println(
        "================================================"
    );


    delay(100);

    sendLoRa(
        "FIELD_READY"
    );


    delay(100);

    sendStatus();


}


/* =========================================================
                           LOOP
   ========================================================= */

void loop()
{
    /*
       Feed the watchdog once per loop iteration. Even the
       worst-case single command (~2.5s of blocking work)
       finishes well inside this loop iteration, well under
       WATCHDOG_TIMEOUT_SECONDS.
    */
    esp_task_wdt_reset();

    checkRelaySafety();

    processLoRaPacket();

    periodicStatus();

    delay(2);
}
