use std::{thread, time::Duration};

use super::{
    RuntimeCommand, RuntimeHandle, parse_ready_url, should_restart_after_plugin,
    stop_retries_exhausted,
};
use crate::plugin_manager::PluginCommandResult;

#[test]
fn accepts_only_strict_loopback_ready_lines() {
    assert_eq!(
        parse_ready_url("dsh web: http://127.0.0.1:43210/"),
        Some("http://127.0.0.1:43210/".to_string())
    );
    assert_eq!(parse_ready_url("dsh web: http://0.0.0.0:43210/"), None);
    assert_eq!(parse_ready_url("prefix dsh web: http://127.0.0.1:1/"), None);
}

#[test]
fn shutdown_fails_when_the_supervisor_is_not_running() {
    let (handle, receiver) = RuntimeHandle::new();
    drop(receiver);

    assert_eq!(
        handle.shutdown_blocking_with_timeout(Duration::ZERO),
        Err("runtime supervisor is not running".to_string())
    );
}

#[test]
fn shutdown_fails_without_a_positive_acknowledgement() {
    let (handle, _receiver) = RuntimeHandle::new();

    assert_eq!(
        handle.shutdown_blocking_with_timeout(Duration::ZERO),
        Err("runtime supervisor did not accept shutdown before the deadline".to_string())
    );
}

#[test]
fn expired_shutdown_cannot_be_accepted_later() {
    let (handle, command_rx) = RuntimeHandle::new();

    assert_eq!(
        handle.shutdown_blocking_with_timeout(Duration::ZERO),
        Err("runtime supervisor did not accept shutdown before the deadline".to_string())
    );
    let command = command_rx
        .recv()
        .expect("shutdown command must remain queued");
    let RuntimeCommand::Shutdown(accepted, _) = command else {
        panic!("queued command must be shutdown");
    };
    assert!(
        accepted.send(()).is_err(),
        "a shutdown whose caller timed out must not be accepted later"
    );
}

#[test]
fn confirmed_shutdown_remains_successful_after_the_worker_stops() {
    let (handle, command_rx) = RuntimeHandle::new();
    let caller = handle.clone();
    let shutdown = thread::spawn(move || caller.shutdown_blocking());

    let RuntimeCommand::Shutdown(accepted, acknowledgement) =
        command_rx.recv().expect("shutdown command must arrive")
    else {
        panic!("queued command must be shutdown");
    };
    accepted.send(()).expect("caller must accept the handshake");
    handle
        .shutdown_confirmed
        .store(true, std::sync::atomic::Ordering::Release);
    acknowledgement
        .send(Ok(()))
        .expect("caller must receive the acknowledgement");
    assert_eq!(
        shutdown.join().expect("shutdown caller must finish"),
        Ok(())
    );
    drop(command_rx);

    assert_eq!(handle.shutdown_blocking(), Ok(()));
}

fn plugin_result(
    success: bool,
    rolled_back: bool,
    profile_unrecoverable: bool,
) -> PluginCommandResult {
    PluginCommandResult {
        success,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        rolled_back,
        profile_unrecoverable,
    }
}

#[test]
fn mutating_plugin_success_restarts_the_runtime() {
    assert!(should_restart_after_plugin(
        true,
        &Ok(plugin_result(true, false, false)),
    ));
}

#[test]
fn successful_rollback_still_restarts_the_restored_profile() {
    assert!(should_restart_after_plugin(
        true,
        &Ok(plugin_result(false, true, false)),
    ));
}

#[test]
fn unrecoverable_profile_does_not_restart_the_runtime() {
    assert!(!should_restart_after_plugin(
        true,
        &Ok(plugin_result(false, false, true)),
    ));
}

#[test]
fn helper_timeouts_must_surface_as_plugin_results_not_supervisor_errors() {
    assert!(
        should_restart_after_plugin(true, &Err("helper timed out".to_string())),
        "Err still restarts a possibly dirty profile; timeouts must return Ok with restore flags"
    );
    assert!(!should_restart_after_plugin(
        true,
        &Ok(plugin_result(false, false, true)),
    ));
}

#[test]
fn read_only_plugin_commands_never_restart() {
    assert!(!should_restart_after_plugin(
        false,
        &Ok(plugin_result(true, false, false)),
    ));
}

#[test]
fn starting_a_new_runtime_requires_a_fresh_shutdown_handshake() {
    let (handle, command_rx) = RuntimeHandle::new();

    handle
        .shutdown_confirmed
        .store(true, std::sync::atomic::Ordering::Release);
    assert_eq!(
        handle.shutdown_blocking(),
        Ok(()),
        "a confirmed shutdown must short-circuit without a new handshake"
    );

    handle.invalidate_shutdown_confirmation();
    assert_eq!(
        handle.shutdown_blocking_with_timeout(Duration::ZERO),
        Err("runtime supervisor did not accept shutdown before the deadline".to_string()),
        "after a runtime restart the shutdown must go through a real handshake again"
    );
    let command = command_rx
        .recv()
        .expect("a fresh shutdown command must be queued");
    assert!(
        matches!(command, RuntimeCommand::Shutdown(..)),
        "queued command must be shutdown"
    );
}

#[test]
fn restart_invalidates_a_stale_shutdown_confirmation() {
    let (handle, command_rx) = RuntimeHandle::new();
    handle
        .shutdown_confirmed
        .store(true, std::sync::atomic::Ordering::Release);
    handle
        .restart()
        .expect("restart must queue while the supervisor channel is open");
    assert_eq!(
        handle.shutdown_blocking_with_timeout(Duration::ZERO),
        Err("runtime supervisor did not accept shutdown before the deadline".to_string()),
        "a queued restart must not let app quit skip the process-tree handshake"
    );
    drop(command_rx);
}

#[test]
fn force_stop_retries_exhaust_at_the_deadline() {
    let window = Duration::from_secs(15);
    assert!(!stop_retries_exhausted(Duration::from_secs(14), window));
    assert!(stop_retries_exhausted(window, window));
    assert!(stop_retries_exhausted(
        window + Duration::from_millis(1),
        window
    ));
}
