use poke_engine::choices::{Choice, Choices, MoveCategory, MOVES};
use poke_engine::engine::generate_instructions::calculate_both_damage_rolls;
use poke_engine::mcts::perform_mcts;
use poke_engine::state::State;
use serde::Serialize;
use std::str::FromStr;
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

#[derive(Serialize)]
struct DamageRolls {
    side_one: Vec<i16>,
    side_two: Vec<i16>,
}

/// Computes the possible damage-roll windows for one hypothetical move
/// exchange, without running a search — the WASM equivalent of poke-engine's
/// Python `calculate_damage(state, s1_move, s2_move, s1_first)`. Used by the
/// extension's reverse damage-calc opponent-set inference (see
/// extension/inference/damage-check.js): for a hypothesized opponent set,
/// compute the damage window a known move would produce, then compare
/// against what was actually observed in the real battle to rule the
/// hypothesis in or out.
///
/// `best_move`'s own results are bare names with no prefix at all (poke-engine's
/// `MoveChoice::to_string()` returns e.g. "closecombat" or "garchomp"
/// directly — see rs-wasm/vendor/poke-engine/src/genx/state.rs). Callers of
/// *this* function may optionally prefix a move with `move:` for their own
/// clarity (extension/inference/damage-check.js does, since it's
/// constructing the string itself rather than round-tripping one from
/// `best_move`) — accepted and stripped here for convenience. Anything
/// starting with `switch` collapses to the bare `"switch"` action, matching
/// foul-play's `poke_engine_get_damage_rolls` (the engine only needs to know
/// *that* a switch happened for damage-calc purposes, not to whom).
#[wasm_bindgen]
pub fn damage_rolls(
    state_str: &str,
    side_one_move: &str,
    side_two_move: &str,
    side_one_moves_first: bool,
) -> Result<JsValue, JsValue> {
    let state = State::deserialize(state_str);

    let choice_for = |mv: &str| -> Result<Choice, JsValue> {
        // Strip an optional "move:" prefix a caller may have added (see this
        // function's doc comment); anything that's a switch collapses to the
        // bare "switch" action (the engine only needs to know a switch
        // happened, not to whom, for damage-calc purposes).
        let is_switch = mv.starts_with("switch");
        let name = if is_switch {
            "switch"
        } else {
            mv.strip_prefix("move:").unwrap_or(mv)
        };
        // Choices::from_str is infallible (unrecognized input silently maps
        // to a default/NONE variant) rather than erroring, so an unknown
        // name won't surface here — that matches poke-engine's own CLI
        // behavior (io.rs does the same lookup-then-unwrap).
        let choices_enum = Choices::from_str(name).unwrap();
        let mut choice = MOVES
            .get(&choices_enum)
            .ok_or_else(|| JsValue::from_str(&format!("No move data for: {name}")))?
            .to_owned();
        if is_switch {
            choice.category = MoveCategory::Switch;
        }
        Ok(choice)
    };

    let s1_choice = choice_for(side_one_move)?;
    let s2_choice = choice_for(side_two_move)?;

    let (s1_rolls, s2_rolls) =
        calculate_both_damage_rolls(&state, s1_choice, s2_choice, side_one_moves_first);

    let out = DamageRolls {
        side_one: s1_rolls.unwrap_or_default(),
        side_two: s2_rolls.unwrap_or_default(),
    };
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}
