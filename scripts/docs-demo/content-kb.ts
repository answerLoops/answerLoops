/**
 * Fictional knowledge-base content for the docs demo workspace.
 *
 * Northwind Robotics, RoverKit and every product name below are invented. The
 * addresses use example.com / example.org, which are reserved for documentation.
 */

export type KbSourceKey = 'manual' | 'url_start' | 'url_api' | 'pdf' | 'github' | 'notion'

export interface KbArticleSeed {
  key: string
  source: KbSourceKey
  question: string
  answer: string
}

export const KB_ARTICLES: KbArticleSeed[] = [
  {
    key: 'install',
    source: 'url_start',
    question: 'How do I install RoverKit on Raspberry Pi OS?',
    answer: `RoverKit 2.x supports Python 3.10 or newer on Raspberry Pi OS (Bookworm, 64-bit).

1. Update the system packages: \`sudo apt update && sudo apt upgrade\`
2. Install the system dependencies: \`sudo apt install python3-venv libgpiod2\`
3. Create a virtual environment and install the SDK:

\`\`\`bash
python3 -m venv ~/rover-env
source ~/rover-env/bin/activate
pip install roverkit
\`\`\`

Run \`rover-cli doctor\` afterwards. It checks the Python version, the serial permissions and whether a controller board is attached.`,
  },
  {
    key: 'flash',
    source: 'url_start',
    question: 'How do I flash new firmware onto the Atlas-2 controller?',
    answer: `Use \`rover-cli\` to flash the Atlas-2. Put the board in bootloader mode first: hold the **BOOT** button, tap **RESET**, then release **BOOT**. The status LED pulses blue.

\`\`\`bash
rover-cli firmware list
rover-cli firmware flash --version 2.4.1
\`\`\`

Do not disconnect USB or battery power while the LED is flashing orange. After a successful flash the board restarts on its own and the LED turns solid green.`,
  },
  {
    key: 'servo-cal',
    source: 'url_start',
    question: 'How do I calibrate servos with the Pico servo hat?',
    answer: `Run the calibration wizard with the servos unloaded (no arm or wheel attached):

\`\`\`bash
rover-cli servo calibrate --channel 0
\`\`\`

The wizard sweeps the servo to its minimum and maximum pulse widths and stores them in \`~/.roverkit/servo.toml\`. Most hobby servos land between 500 and 2500 microseconds. If a servo buzzes at the end of its travel, shrink the range by 50 microseconds on that side and run the wizard again.`,
  },
  {
    key: 'lidar',
    source: 'pdf',
    question: 'How do I connect the Scout-L1 lidar and read scans?',
    answer: `The Scout-L1 connects to the Atlas-2 on the **UART-B** header. Wire TX to RX and RX to TX, and power it from the 5V rail, not from the 3.3V rail.

\`\`\`python
from roverkit.sensors import ScoutL1

lidar = ScoutL1(port="uart-b")
for scan in lidar.scans():
    print(scan.min_distance_mm, scan.angle_deg)
\`\`\`

A full rotation takes about 100 ms at the default 10 Hz. If scans come back empty, check that the spin motor LED on the module is lit.`,
  },
  {
    key: 'sim',
    source: 'url_start',
    question: 'Can I test my code without hardware using RoverSim?',
    answer: `Yes. RoverSim is a physics simulator that ships with the SDK and exposes the same Python API as the real controller.

\`\`\`bash
pip install "roverkit[sim]"
rover-cli sim start --world maze-small
\`\`\`

Point your script at the simulator by setting \`ROVER_TARGET=sim\`. Sensors such as the lidar and the wheel encoders are simulated with configurable noise, so a script that works in RoverSim usually needs only small tuning on the real robot.`,
  },
  {
    key: 'pinmap',
    source: 'pdf',
    question: 'What is the motor driver pin map for the Atlas-2?',
    answer: `The Atlas-2 has two dual-channel motor drivers, labelled **M1-M4**.

| Channel | Direction pin | PWM pin | Current limit |
| --- | --- | --- | --- |
| M1 | GPIO 4 | GPIO 5 | 3 A |
| M2 | GPIO 6 | GPIO 7 | 3 A |
| M3 | GPIO 8 | GPIO 9 | 3 A |
| M4 | GPIO 10 | GPIO 11 | 3 A |

Motor power comes from the **VMOT** terminal (6 to 14 V). Never power motors from the USB port.`,
  },
  {
    key: 'battery',
    source: 'pdf',
    question: 'Which batteries are safe to use with RoverKit robots?',
    answer: `The Atlas-2 accepts 2S or 3S LiPo packs (7.4 V to 11.1 V) with an XT30 connector. Packs above 3S are not supported and will trigger the over-voltage cutoff.

- Always charge in a fireproof bag and never leave a pack charging unattended.
- Stop using any pack that is swollen or that has lost more than 20% of its original capacity.
- Set the low-voltage warning with \`rover-cli power set --cutoff 3.5\` (volts per cell).`,
  },
  {
    key: 'usb-notfound',
    source: 'manual',
    question: 'Why do I get "device not found" when the controller is plugged in?',
    answer: `This is almost always a serial permission problem on Linux.

1. Confirm the board shows up: \`ls /dev/ttyACM*\`
2. Add your user to the serial group: \`sudo usermod -aG dialout $USER\`
3. Log out and back in so the new group applies.

If \`/dev/ttyACM0\` does not exist at all, try a different USB cable. Charge-only cables are the most common cause.`,
  },
  {
    key: 'drive',
    source: 'url_api',
    question: 'How does DriveController work in the Python API?',
    answer: `\`DriveController\` turns a speed and a turn rate into motor commands for a two-wheel or four-wheel base.

\`\`\`python
from roverkit import Rover, DriveController

rover = Rover.connect()
drive = DriveController(rover, wheel_base_mm=180)
drive.move(speed=0.4, turn=0.0, duration=2.0)
drive.stop()
\`\`\`

Speed and turn are normalized between -1.0 and 1.0. Call \`drive.stop()\` in a \`finally\` block so the motors never keep running after an exception.`,
  },
  {
    key: 'pid',
    source: 'url_api',
    question: 'How do I tune the PID controller for line following?',
    answer: `Start with only the proportional term and raise it until the robot follows the line but oscillates.

1. Set \`ki = 0\` and \`kd = 0\`.
2. Raise \`kp\` in steps of 0.1 until the robot starts to wobble, then reduce it by 30%.
3. Add \`kd\` until the wobble settles. A good starting ratio is \`kd = 8 * kp\`.
4. Only add a small \`ki\` (under 0.01) if the robot drifts to one side on long straights.

Use \`rover-cli plot pid\` to see the error over time while you tune.`,
  },
  {
    key: 'telemetry',
    source: 'url_api',
    question: 'How do I stream telemetry to the dashboard?',
    answer: `Enable the telemetry service on the robot and open the dashboard on any device on the same network.

\`\`\`python
from roverkit.telemetry import Telemetry

telemetry = Telemetry(rover, port=8750)
telemetry.publish("battery_v", rover.power.voltage)
\`\`\`

Then browse to \`http://<robot-address>:8750\`. Values you publish appear as live charts. Telemetry is not encrypted, so only use it on a trusted network.`,
  },
  {
    key: 'ota',
    source: 'github',
    question: 'Does RoverKit support over-the-air firmware updates?',
    answer: `Yes, for Atlas-2 boards with the Wi-Fi daughter module. Run:

\`\`\`bash
rover-cli firmware update --ota --host rover.local
\`\`\`

The board downloads the signed firmware image, verifies it and reboots. If verification fails the board keeps its current firmware, so a bad transfer cannot brick it. OTA updates require firmware 2.2.0 or newer.`,
  },
  {
    key: 'migrate-2',
    source: 'github',
    question: 'How do I migrate from RoverKit 1.x to 2.0?',
    answer: `The main changes in 2.0 are:

- \`rover.drive()\` is now \`DriveController.move()\`.
- Sensor classes moved to \`roverkit.sensors\`.
- Configuration moved from \`rover.ini\` to \`rover.toml\`.

Run \`rover-cli migrate-config rover.ini\` to convert your configuration automatically. The 1.x API keeps working with deprecation warnings until version 2.3.`,
  },
  {
    key: 'i2c',
    source: 'github',
    question: 'How do I resolve I2C address conflicts between sensors?',
    answer: `Run \`rover-cli i2c scan\` to list every address on the bus. If two sensors report the same address, either move one to the second bus (\`i2c-2\` on the Atlas-2) or change its address with the jumper pads on the module.

Many IMU and distance sensors expose an address pin. Tie it high to move the device to its alternate address, then pass \`address=0x69\` when you create the sensor object.`,
  },
  {
    key: 'ros2',
    source: 'github',
    question: 'How do I set up the ROS 2 bridge?',
    answer: `The bridge publishes odometry, lidar scans and battery state as standard ROS 2 topics.

\`\`\`bash
pip install "roverkit[ros2]"
rover-cli ros2 bridge --namespace /rover1
\`\`\`

Velocity commands are accepted on \`/rover1/cmd_vel\`. The bridge supports ROS 2 Humble and Jazzy. Support for ROS 1 is not available.`,
  },
  {
    key: 'warranty',
    source: 'manual',
    question: 'What is the warranty and return policy for Northwind hardware?',
    answer: `Northwind Robotics hardware has a 12-month warranty against manufacturing defects. Damage from over-voltage, reverse polarity or water is not covered.

Returns are accepted within 30 days of delivery if the item is unused and in its original packaging. To start a return, email the support team at support@example.com with your order number.`,
  },
  {
    key: 'supported',
    source: 'manual',
    question: 'Which boards and operating systems does RoverKit support?',
    answer: `RoverKit 2.x is tested on:

- Raspberry Pi OS (64-bit) on Pi 4 and Pi 5
- Ubuntu 22.04 and 24.04 on x86-64 and ARM64
- macOS 13 or newer (simulator and tools only, no hardware access)

The Atlas-2 controller works with any of these over USB. Windows is not supported at this time.`,
  },
  {
    key: 'plugin',
    source: 'notion',
    question: 'How do I write a custom behavior plugin?',
    answer: `A behavior plugin is a Python class that implements \`on_tick(self, state)\` and returns an optional command.

\`\`\`python
from roverkit.behaviors import Behavior

class AvoidWall(Behavior):
    def on_tick(self, state):
        if state.lidar.min_distance_mm < 250:
            return {"speed": 0.0, "turn": 0.6}
\`\`\`

Register it in \`rover.toml\` under \`[behaviors]\`. Behaviors run in priority order and the first one that returns a command wins.`,
  },
  {
    key: 'jitter',
    source: 'notion',
    question: 'Why are my servos jittering?',
    answer: `Servo jitter is usually caused by power, not code.

- Power servos from a dedicated 5 to 6 V supply, not from the controller's logic rail.
- Add a 470 microfarad capacitor across the servo power rails.
- Share the ground between the servo supply and the controller.
- Lower the update rate with \`servo.set_rate(50)\` if you are writing positions faster than 50 Hz.`,
  },
  {
    key: 'gamepad',
    source: 'manual',
    question: 'How do I pair a Bluetooth gamepad?',
    answer: `Pair the gamepad with the host computer first, then tell RoverKit to use it.

1. Put the gamepad in pairing mode and run \`bluetoothctl\` to pair and trust it.
2. Run \`rover-cli gamepad test\` to confirm that button presses appear.
3. Start teleoperation with \`rover-cli teleop --gamepad\`.

The left stick maps to speed and turn, the right trigger acts as a boost and the **B** button stops the motors immediately.`,
  },
  {
    key: 'doctor',
    source: 'manual',
    question: 'How do I create a diagnostics bundle for support?',
    answer: `Run \`rover-cli doctor --bundle\`. It writes a zip file with your SDK version, firmware version, board logs and a hardware scan to the current folder.

The bundle never includes your code or any Wi-Fi passwords. Attach it to your support request so the team can see your setup without asking you to run a list of commands.`,
  },
]

export const KB_SOURCE_META: Record<Exclude<KbSourceKey, 'manual'>, { filename: string; fileType: string; sizeBytes: number; published: number }> = {
  url_start: { filename: 'https://docs.example.com/roverkit/getting-started', fileType: 'url', sizeBytes: 41872, published: 1 },
  url_api: { filename: 'https://docs.example.com/roverkit/api-reference', fileType: 'url', sizeBytes: 96304, published: 1 },
  pdf: { filename: 'Atlas-2-Hardware-Manual.pdf', fileType: 'pdf', sizeBytes: 2481920, published: 1 },
  github: { filename: 'northwind-robotics-demo/roverkit-docs', fileType: 'github', sizeBytes: 52480, published: 1 },
  notion: { filename: 'notion:workspace', fileType: 'notion', sizeBytes: 18944, published: 0 },
}
