use poke_engine::mcts::perform_mcts;
use poke_engine::state::State;
use serde::Serialize;
use std::time::Duration;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[derive(Serialize)]
struct MoveScore {
    choice: String,
    avg_score: f32,
    visits: u32,
}

#[derive(Serialize)]
struct SearchResult {
    side_one: Vec<MoveScore>,
    side_two: Vec<MoveScore>,
    iterations: u32,
}

/// Runs poke-engine's single-threaded MCTS against a battle state.
///
/// `state_str` uses poke-engine's native pipe-delimited `State::deserialize`
/// format (the same format its CLI's `-s` flag takes), not JSON.
/// `max_iterations` must be > 0 — this binding always searches by iteration
/// count, never by wall-clock time (see vendor/poke-engine/README.md for why).
#[wasm_bindgen]
pub fn best_move(state_str: &str, max_iterations: u32) -> Result<JsValue, JsValue> {
    let mut state = State::deserialize(state_str);
    let (s1_options, s2_options) = state.root_get_all_options();
    let result = perform_mcts(
        &mut state,
        s1_options,
        s2_options,
        Duration::ZERO,
        max_iterations.max(1),
    );

    let out = SearchResult {
        side_one: result
            .s1
            .iter()
            .map(|m| MoveScore {
                choice: m.move_choice.to_string(&state.side_one),
                avg_score: m.average_score(),
                visits: m.visits,
            })
            .collect(),
        side_two: result
            .s2
            .iter()
            .map(|m| MoveScore {
                choice: m.move_choice.to_string(&state.side_two),
                avg_score: m.average_score(),
                visits: m.visits,
            })
            .collect(),
        iterations: result.iteration_count,
    };

    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}
