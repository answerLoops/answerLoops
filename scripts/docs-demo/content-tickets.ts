/**
 * Fictional community questions for the docs demo workspace. Every product,
 * person and address is invented.
 */

export type TopicCategory = 'bug' | 'feature_request' | 'documentation' | 'how_to' | 'general_question'

export interface AnsweredTopic {
  category: Exclude<TopicCategory, 'bug' | 'feature_request'>
  summary: string
  question: string
  answer: string
}

// Questions the knowledge base can answer. [category, summary, question, answer]
type AnsweredTuple = [AnsweredTopic['category'], string, string, string]

const answered: AnsweredTuple[] = [
  ['how_to', 'Install RoverKit on a Pi 5', 'hey, just got my Pi 5 and want to try RoverKit. what is the cleanest way to install it? tried pip globally and got an externally-managed-environment error', 'That error is Raspberry Pi OS protecting its system Python. Create a virtual environment first (`python3 -m venv ~/rover-env`), activate it, and then run `pip install roverkit`. Running `rover-cli doctor` afterwards confirms that the install is healthy.'],
  ['how_to', 'Flash Atlas-2 firmware', 'How do I update the firmware on my Atlas-2? The one that shipped is 2.1.0 and the docs mention 2.4.', 'Put the board into bootloader mode (hold BOOT, tap RESET, release BOOT) and run `rover-cli firmware flash --version 2.4.1`. Leave the board powered until the LED turns solid green.'],
  ['how_to', 'Calibrate servo range', 'my arm servo hits the end stop and buzzes. is there a way to set safe limits?', 'Run `rover-cli servo calibrate --channel 0` with the arm unloaded. The wizard finds the real pulse range and stores it in `~/.roverkit/servo.toml`. If it still buzzes, shrink the range by 50 microseconds on that side and calibrate again.'],
  ['documentation', 'Scout-L1 wiring', 'Which header does the Scout-L1 lidar plug into on the Atlas-2? the silkscreen is hard to read', 'The Scout-L1 goes on the UART-B header. Connect TX to RX and RX to TX, and power it from the 5V rail rather than the 3.3V rail.'],
  ['how_to', 'Run code without a robot', 'is there any way to test my navigation script before the hardware arrives next week?', 'Yes, RoverSim runs the same Python API against a simulated robot. Install it with `pip install "roverkit[sim]"`, start a world with `rover-cli sim start --world maze-small`, and run your script with `ROVER_TARGET=sim`.'],
  ['documentation', 'Motor driver pins', 'need the GPIO numbers for the M3 and M4 motor channels on Atlas-2', 'M3 uses GPIO 8 for direction and GPIO 9 for PWM. M4 uses GPIO 10 and GPIO 11. Each channel is rated for 3 A.'],
  ['general_question', 'LiPo pack compatibility', 'can I use a 4S LiPo? I have one lying around from a drone', 'Not safely. The Atlas-2 supports 2S and 3S packs (7.4 V to 11.1 V) with an XT30 connector, and a 4S pack will trigger the over-voltage cutoff.'],
  ['how_to', 'Fix device not found', 'rover-cli says "device not found" even though the board LED is on', 'This is usually a serial permission problem. Add your user to the dialout group with `sudo usermod -aG dialout $USER`, then log out and back in. If `/dev/ttyACM0` is missing, try a different USB cable, since charge-only cables are a common cause.'],
  ['how_to', 'Drive forward for a duration', 'whats the simplest way to make the rover drive forward for 2 seconds and stop', 'Use `DriveController`: `drive.move(speed=0.4, turn=0.0, duration=2.0)` followed by `drive.stop()`. Put the stop call in a `finally` block so the motors are never left running.'],
  ['how_to', 'PID tuning order', 'my line follower wobbles like crazy. how should I tune kp kd ki?', 'Set ki and kd to zero, raise kp until the robot just starts to wobble, then back it off by about 30%. Add kd next (a good start is 8 times kp) and only add a very small ki if it drifts on long straights.'],
  ['how_to', 'Live telemetry charts', 'Can I see battery voltage live while the robot is moving?', 'Yes. Create a `Telemetry` object, publish values with `telemetry.publish("battery_v", rover.power.voltage)`, and open `http://<robot-address>:8750` in a browser on the same network.'],
  ['general_question', 'OTA updates', 'do atlas boards support OTA updates or is it USB only?', 'Boards with the Wi-Fi daughter module support OTA updates on firmware 2.2.0 or newer. Run `rover-cli firmware update --ota --host rover.local`. A failed transfer keeps the old firmware, so it cannot brick the board.'],
  ['how_to', 'Migrate from 1.x', 'upgrading from 1.8 and rover.drive() is gone. what replaced it?', 'It is now `DriveController.move()`. Run `rover-cli migrate-config rover.ini` to convert your configuration, and note that the 1.x API still works with deprecation warnings until version 2.3.'],
  ['how_to', 'I2C address conflict', 'two IMUs on one bus both show 0x68. how do i use both', 'Move one sensor to the second bus (`i2c-2` on the Atlas-2) or tie its address pin high so it moves to 0x69, then pass `address=0x69` when you create the sensor object. `rover-cli i2c scan` lists every address on the bus.'],
  ['how_to', 'ROS 2 bridge', 'does RoverKit publish odometry to ROS 2? how do I turn it on', 'Yes. Install `roverkit[ros2]` and run `rover-cli ros2 bridge --namespace /rover1`. Velocity commands go to `/rover1/cmd_vel`. Humble and Jazzy are supported.'],
  ['general_question', 'Warranty length', 'how long is the warranty on the Atlas-2?', 'Northwind hardware has a 12-month warranty against manufacturing defects. Over-voltage, reverse polarity and water damage are not covered.'],
  ['general_question', 'Return window', 'I ordered the wrong servo hat, can I return it?', 'Returns are accepted within 30 days of delivery if the item is unused and in its original packaging. Email support@example.com with your order number to start one.'],
  ['general_question', 'Supported operating systems', 'does roverkit run on macOS? I only have a macbook', 'RoverKit installs on macOS 13 or newer, but only the simulator and command-line tools work there because there is no hardware access. For a real robot, use Raspberry Pi OS or Ubuntu.'],
  ['how_to', 'Custom behavior plugin', 'how can I add my own obstacle avoidance without forking the sdk', 'Write a `Behavior` subclass with an `on_tick(self, state)` method that returns a command, then register it under `[behaviors]` in `rover.toml`. Behaviors run in priority order and the first one to return a command wins.'],
  ['how_to', 'Servo jitter', 'servos twitch constantly when idle', 'That is usually power. Use a dedicated 5 to 6 V supply for the servos, add a 470 microfarad capacitor across the servo rails and share the ground with the controller. Lowering the update rate with `servo.set_rate(50)` also helps.'],
  ['how_to', 'Pair a gamepad', 'How do I drive with a PS-style bluetooth controller?', 'Pair and trust the controller with `bluetoothctl`, check it with `rover-cli gamepad test`, then start driving with `rover-cli teleop --gamepad`. The B button stops the motors immediately.'],
  ['how_to', 'Diagnostics for support', 'support asked me for logs, what do i send', 'Run `rover-cli doctor --bundle` and attach the zip file it creates. It contains version information and board logs but never your code or Wi-Fi passwords.'],
  ['documentation', 'Pip install fails on Ubuntu', 'pip install roverkit fails on ubuntu 24.04 with a build error for libgpiod', 'Install the system library first with `sudo apt install libgpiod2` (and `python3-venv` if you have not created a virtual environment). After that `pip install roverkit` should build cleanly.'],
  ['how_to', 'Encoder ticks per rev', 'what are the encoder ticks per revolution for the standard wheel motors?', 'The standard 12 V gear motors have a 16 tick encoder on the motor shaft and a 30:1 gearbox, which is 480 ticks per wheel revolution when counting both edges of both channels.'],
  ['how_to', 'Set low battery cutoff', 'can I make the rover shut down automatically when the battery gets low', 'Yes. Run `rover-cli power set --cutoff 3.5` to set the per-cell cutoff in volts. The Atlas-2 stops the motors and blinks the status LED red when the pack falls below it.'],
  ['general_question', 'Python version', 'which python versions does roverkit 2 need', 'RoverKit 2.x needs Python 3.10 or newer. Python 3.12 is the version we test most.'],
  ['how_to', 'Read lidar scans', 'got the lidar wired, how do I print the distances', 'Create a `ScoutL1(port="uart-b")` object and iterate over `lidar.scans()`. Each scan has `min_distance_mm` and `angle_deg`. If scans are empty, check that the spin motor LED on the module is lit.'],
  ['documentation', 'Where is rover.toml', 'where does roverkit look for rover.toml', 'RoverKit reads `./rover.toml` first, then `~/.roverkit/rover.toml`. Set `ROVER_CONFIG` to point at any other file.'],
  ['how_to', 'Mecanum wheel setup', 'is there an example for mecanum wheels', 'Yes. Pass `base="mecanum"` to `DriveController` and use `drive.move(speed, turn, strafe=0.3)`. The wheel order is front-left, front-right, rear-left, rear-right, matching M1 to M4.'],
  ['how_to', 'Record sensor data', 'how do I log sensor readings to a csv while driving', 'Use `rover.recorder.start("run1.csv", fields=["lidar.min_distance_mm", "power.voltage"])` and call `rover.recorder.stop()` when you are finished. Rows are written at 20 Hz by default.'],
  ['general_question', 'Is RoverKit open source', 'is the sdk open source? what license', 'The RoverKit Python SDK is open source under the Apache 2.0 license. The simulator and the Atlas-2 firmware are distributed in binary form.'],
  ['how_to', 'Emergency stop button', 'how do I wire a physical e-stop', 'Wire a normally-closed button between the EST header pins on the Atlas-2. Opening the circuit cuts power to all four motor drivers in hardware, regardless of what your code is doing.'],
  ['documentation', 'Simulator worlds', 'what worlds come with roversim?', 'RoverSim ships with `empty`, `maze-small`, `maze-large`, `line-track` and `obstacle-field`. List them with `rover-cli sim worlds`.'],
  ['how_to', 'Change wheel diameter', 'my wheels are 80mm not 65mm, odometry is off', 'Set `wheel_diameter_mm = 80` under `[drive]` in `rover.toml` and restart. Odometry is recomputed from that value, so no re-calibration is needed.'],
  ['how_to', 'Run on boot', 'how do I start my script automatically when the pi powers on', 'Create a systemd service that runs your script inside the virtual environment, or use `rover-cli service install my_script.py`, which writes the unit file for you.'],
  ['general_question', 'Max payload', 'how much weight can the standard chassis carry', 'The standard Atlas chassis is rated for 2.5 kg of payload on flat ground. Heavier loads work, but acceleration and battery life drop quickly.'],
  ['how_to', 'Multiple robots on a network', 'can I control two rovers from one laptop', 'Yes. Give each robot a unique `name` in `rover.toml`, then connect with `Rover.connect("rover-a.local")` and `Rover.connect("rover-b.local")`. Telemetry shows both robots on the same dashboard.'],
  ['documentation', 'Atlas-2 LED meanings', 'what do the status led colors mean', 'Solid green means ready, pulsing blue means bootloader mode, flashing orange means a firmware update is in progress and blinking red means a low battery or a fault. `rover-cli doctor` names the fault.'],
  ['how_to', 'Speed limits', 'how do I cap max speed so my kid cant crash it', 'Set `max_speed = 0.5` under `[drive]` in `rover.toml`. Every command is clamped to that value, including gamepad input.'],
  ['how_to', 'Camera streaming', 'can I stream the pi camera through roverkit', 'Yes. Enable `[camera]` in `rover.toml` and the camera appears on the telemetry dashboard at `http://<robot-address>:8750/camera`. The default is 640x480 at 15 frames per second.'],
  ['how_to', 'Reset to factory settings', 'my config is a mess, how do I reset everything', 'Run `rover-cli reset --config` to restore the default configuration. Add `--servo` if you also want to clear servo calibration.'],
  ['general_question', 'Classroom discount', 'do you offer discounts for schools or robotics clubs', 'Yes, clubs and schools get 15% off orders of five or more Atlas-2 boards. Email support@example.com from your school address to get a code.'],
  ['how_to', 'Wi-Fi setup', 'how do I connect the atlas wifi module to my network', 'Run `rover-cli wifi connect --ssid <network-name>` and enter the password when prompted. The credentials are stored on the board and never leave it.'],
  ['documentation', 'Gear ratio options', 'what gear ratios are available for the drive motors', 'The 12 V drive motors come in 30:1, 50:1 and 100:1. Use 30:1 for speed, 50:1 as an all-rounder and 100:1 for torque with heavy payloads.'],
  ['how_to', 'Async API', 'is there an asyncio version of the api', 'Yes. Import from `roverkit.aio` instead, for example `from roverkit.aio import Rover`. Every blocking call has an awaitable equivalent with the same name.'],
  ['how_to', 'Disable the startup beep', 'atlas beeps on boot, can i turn it off', 'Add `startup_sound = false` under `[board]` in `rover.toml` and restart the board.'],
  ['general_question', 'Shipping times', 'how long does shipping take to europe', 'Orders to the EU usually arrive within 5 to 8 business days. You get a tracking link by email as soon as the order ships.'],
]

export const ANSWERED_TOPICS: AnsweredTopic[] = answered.map(([category, summary, question, answer]) => ({
  category,
  summary,
  question,
  answer,
}))

export interface IssueTopic {
  category: 'bug' | 'feature_request'
  summary: string
  question: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  resolution?: string
}

export const ISSUE_TOPICS: IssueTopic[] = [
  { category: 'bug', priority: 'high', summary: 'Encoder count resets after reboot', question: 'After upgrading to 2.4.1 the wheel encoder counts reset to zero in the middle of a run. It happens about every 10 minutes. Logs attached from rover-cli doctor.', resolution: 'Fixed in firmware 2.4.2: the counter overflowed on long runs.' },
  { category: 'bug', priority: 'critical', summary: 'Motors keep running after script crash', question: 'My script raised an exception and the robot kept driving into the wall. I expected the motors to stop. Is this a bug?', resolution: 'Added a watchdog in 2.4.2 that stops the motors if no command arrives within 500 ms.' },
  { category: 'bug', priority: 'medium', summary: 'rover-cli sim crashes on macOS', question: 'rover-cli sim start segfaults on my M2 mac with macOS 14. Python 3.12, roverkit 2.4.1.' },
  { category: 'bug', priority: 'medium', summary: 'Telemetry dashboard blank in Safari', question: 'The telemetry dashboard shows a blank page in Safari 17 but works in Firefox.' },
  { category: 'bug', priority: 'high', summary: 'Lidar scans drop frames at 20 Hz', question: 'Scout-L1 at 20 Hz drops about one in five frames on a Pi 4. At 10 Hz it is fine.' },
  { category: 'bug', priority: 'low', summary: 'Typo in rover-cli help text', question: 'The help text for `rover-cli servo calibrate` says "pulse widht". Tiny thing but it is the first thing I saw.', resolution: 'Fixed, thanks for catching it.' },
  { category: 'bug', priority: 'medium', summary: 'Wi-Fi OTA fails behind a captive portal', question: 'OTA update hangs at 40% on our school network. Plain USB flashing works fine.' },
  { category: 'bug', priority: 'high', summary: 'Gamepad B button does not stop motors', question: 'With the 8BitDo-style controller the B button does nothing, the robot keeps moving. Is the mapping different?', resolution: 'The mapping is now configurable under [gamepad] in rover.toml; shipped in 2.4.2.' },
  { category: 'feature_request', priority: 'medium', summary: 'Native Windows support', question: 'Would love native Windows support for the CLI. WSL works but USB passthrough is painful.' },
  { category: 'feature_request', priority: 'low', summary: 'Dark mode for dashboard', question: 'Feature request: dark mode on the telemetry dashboard. Running demos in a dim room is rough.' },
  { category: 'feature_request', priority: 'medium', summary: 'Waypoint navigation helper', question: 'It would be great to have a built-in waypoint navigation helper, something like drive.goto(x, y).' },
  { category: 'feature_request', priority: 'low', summary: 'Export telemetry to CSV', question: 'Can the dashboard export charts as CSV? I am writing up a science fair project.', resolution: 'Shipped in 2.4.2: use the export button on any chart.' },
  { category: 'feature_request', priority: 'medium', summary: 'Rust bindings', question: 'Any plans for Rust bindings? I would happily help test them.' },
  { category: 'feature_request', priority: 'low', summary: 'More simulator worlds', question: 'Please add a competition-style line track world with intersections to RoverSim.' },
]

export interface GapTopic {
  cluster: string
  category: Exclude<TopicCategory, 'bug' | 'feature_request'>
  summary: string
  question: string
  draft: string
}

// Questions the knowledge base cannot answer. Entries that share a cluster are
// the same underlying question asked in different words, so the Knowledge Gaps
// page can fold them into one row with a count.
export const GAP_TOPICS: GapTopic[] = [
  { cluster: 'windows', category: 'how_to', summary: 'Install RoverKit on Windows 11', question: 'How do I install RoverKit on Windows 11? I do not have a Linux machine.', draft: 'Windows is not listed as a supported platform, and the knowledge base has no setup steps for it. I would suggest using WSL, but I could not confirm whether USB passthrough works with the Atlas-2.' },
  { cluster: 'windows', category: 'how_to', summary: 'Windows driver for the Atlas-2', question: 'windows driver for the atlas 2? device manager shows unknown device', draft: 'I could not find anything in the documentation about Windows drivers for the Atlas-2.' },
  { cluster: 'windows', category: 'general_question', summary: 'Windows installer for rover-cli', question: 'Is there a Windows installer for rover-cli or only pip?', draft: 'There is no mention of a Windows installer in the knowledge base.' },
  { cluster: 'scout-l2', category: 'general_question', summary: 'Scout-L2 support in RoverKit 2.4', question: 'Is the new Scout-L2 lidar supported by RoverKit 2.4? I only see L1 in the docs.', draft: 'The documentation only describes the Scout-L1. I do not have information on the Scout-L2.' },
  { cluster: 'scout-l2', category: 'documentation', summary: 'Scout-L2 wiring diagram', question: 'Where is the wiring diagram for the Scout-L2? ordered one yesterday', draft: 'I could not find a wiring diagram for the Scout-L2 in the knowledge base.' },
  { cluster: 'fuel-gauge', category: 'how_to', summary: 'Battery percentage instead of voltage', question: 'Can I get a battery percentage instead of just voltage?', draft: 'Only voltage is documented. I could not find a percentage or fuel gauge reading.' },
  { cluster: 'fuel-gauge', category: 'how_to', summary: 'State of charge estimate for LiPo', question: 'Is there a state of charge estimate for the LiPo? voltage jumps around under load', draft: 'The documentation does not describe a state of charge estimate.' },
  { cluster: 'ros1', category: 'how_to', summary: 'ROS 1 Noetic bridge', question: 'Do you have a bridge for ROS 1 Noetic? our lab is still on it', draft: 'The documentation says ROS 1 is not supported, but it does not explain whether there is a workaround.' },
  { cluster: 'ros1', category: 'how_to', summary: 'ros1_bridge with the ROS 2 bridge', question: 'Can I use the ROS 2 bridge with ros1_bridge to reach Noetic?', draft: 'I could not find guidance on combining the bridge with ros1_bridge.' },
  { cluster: 'servo-chain', category: 'how_to', summary: 'Stack two Pico servo hats', question: 'Can I stack two Pico servo hats to get 32 channels?', draft: 'The documentation does not say whether servo hats can be stacked.' },
  { cluster: 'servo-chain', category: 'documentation', summary: 'Servo hat I2C address', question: 'what is the I2C address of the servo hat and can it be changed', draft: 'I could not find the servo hat address in the knowledge base.' },
  { cluster: 'jetson', category: 'general_question', summary: 'Run RoverKit on a Jetson', question: 'Will RoverKit run on a Jetson Orin Nano?', draft: 'ARM64 Ubuntu is listed as supported but a Jetson is not mentioned, so I cannot confirm.' },
  { cluster: 'cad', category: 'general_question', summary: 'CAD files for the chassis', question: 'Are STEP or STL files for the Atlas chassis available? I want to print a bracket.', draft: 'The knowledge base does not mention downloadable CAD files.' },
  { cluster: 'rust', category: 'general_question', summary: 'Rust crate for RoverKit', question: 'Is there an official rust crate, or only python?', draft: 'Only the Python SDK is documented.' },
]
