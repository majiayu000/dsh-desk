use std::{thread, time::Duration};

use super::{RuntimeCommand, RuntimeHandle, parse_ready_url};

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
    let delayed_supervisor = thread::spawn(move || {
        thread::sleep(Duration::from_millis(30));
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
    });

    assert_eq!(
        handle.shutdown_blocking_with_timeout(Duration::from_millis(10)),
        Err("runtime supervisor did not accept shutdown before the deadline".to_string())
    );
    delayed_supervisor
        .join()
        .expect("delayed supervisor must finish");
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
