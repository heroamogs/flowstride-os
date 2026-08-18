use wasm_bindgen::prelude::*;

// Native helper to precisely sketch rounded rectangles
pub fn draw_rounded_rect(
    context: &web_sys::CanvasRenderingContext2d,
    x: f64, y: f64, w: f64, h: f64, r: f64
) {
    context.begin_path();
    context.move_to(x + r, y);
    context.line_to(x + w - r, y);
    context.quadratic_curve_to(x + w, y, x + w, y + r);
    context.line_to(x + w, y + h - r);
    context.quadratic_curve_to(x + w, y + h, x + w - r, y + h);
    context.line_to(x + r, y + h);
    context.quadratic_curve_to(x, y + h, x, y + h - r);
    context.line_to(x, y + r);
    context.quadratic_curve_to(x, y, x + r, y);
    context.close_path();
}

// Native helper function to calculate and render text wrapping securely on the canvas
pub fn wrap_canvas_text(
    context: &web_sys::CanvasRenderingContext2d,
    text: &str,
    x: f64,
    mut y: f64,
    max_width: f64,
    line_height: f64,
) -> Result<(), JsValue> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut line = String::new();

    for word in words {
        let test_line = if line.is_empty() {
            word.to_string()
        } else {
            format!("{} {}", line, word)
        };

        let metrics = context.measure_text(&test_line)?;
        if metrics.width() > max_width && !line.is_empty() {
            context.fill_text(&line, x, y)?;
            line = word.to_string();
            y += line_height;
        } else {
            line = test_line;
        }
    }
    
    if !line.is_empty() {
        context.fill_text(&line, x, y)?;
    }
    
    Ok(())
}

// Native helper to precalculate the total height of wrapped text
pub fn calculate_wrapped_text_height(
    context: &web_sys::CanvasRenderingContext2d,
    text: &str,
    max_width: f64,
    line_height: f64,
) -> Result<f64, JsValue> {
    if text.is_empty() {
        return Ok(0.0);
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut line = String::new();
    let mut lines = 1.0;

    for word in words {
        let test_line = if line.is_empty() {
            word.to_string()
        } else {
            format!("{} {}", line, word)
        };

        let metrics = context.measure_text(&test_line)?;
        if metrics.width() > max_width && !line.is_empty() {
            line = word.to_string();
            lines += 1.0;
        } else {
            line = test_line;
        }
    }
    
    Ok(lines * line_height)
}

// Native helper to render straight freehand arrows independently
#[allow(clippy::too_many_arguments)]
pub fn draw_straight_arrow(
    context: &web_sys::CanvasRenderingContext2d,
    start_x: f64, start_y: f64,
    end_x: f64, end_y: f64,
    color: &str,
    is_live_drawing: bool,
) -> Result<(), JsValue> {
    context.begin_path();
    context.set_stroke_style(&JsValue::from_str(color));
    context.set_line_width(if is_live_drawing { 3.0 } else { 2.0 });

    context.move_to(start_x, start_y);
    context.line_to(end_x, end_y);
    context.stroke();

    if is_live_drawing {
        context.begin_path();
        context.arc(end_x, end_y, 6.0, 0.0, std::f64::consts::PI * 2.0)?;
        context.set_fill_style(&JsValue::from_str(color));
        context.fill();
    } else {
        let dx = end_x - start_x;
        let dy = end_y - start_y;
        let angle = dy.atan2(dx);
        
        context.begin_path();
        context.move_to(end_x, end_y);
        context.line_to(end_x - 12.0 * (angle - std::f64::consts::PI / 6.0).cos(), end_y - 12.0 * (angle - std::f64::consts::PI / 6.0).sin());
        context.line_to(end_x - 12.0 * (angle + std::f64::consts::PI / 6.0).cos(), end_y - 12.0 * (angle + std::f64::consts::PI / 6.0).sin());
        context.line_to(end_x, end_y);
        context.set_fill_style(&JsValue::from_str(color));
        context.fill();
    }

    Ok(())
}

// STRICT MICRO STEP 6B: Native helper to render continuous orthogonal right angle lines
pub fn draw_orthogonal_arrow(
    context: &web_sys::CanvasRenderingContext2d,
    path: &[(f64, f64)],
    color: &str,
    is_live_drawing: bool,
) -> Result<(), JsValue> {
    if path.is_empty() {
        return Ok(());
    }

    context.begin_path();
    context.set_stroke_style(&JsValue::from_str(color));
    context.set_line_width(if is_live_drawing { 3.0 } else { 2.0 });

    let start = path[0];
    context.move_to(start.0, start.1);

    for pt in path.iter().skip(1) {
        context.line_to(pt.0, pt.1);
    }
    context.stroke();

    let end = path.last().unwrap();

    if is_live_drawing {
        context.begin_path();
        context.arc(end.0, end.1, 6.0, 0.0, std::f64::consts::PI * 2.0)?;
        context.set_fill_style(&JsValue::from_str(color));
        context.fill();
    } else if path.len() >= 2 {
        let prev = path[path.len() - 2];
        let dx = end.0 - prev.0;
        let dy = end.1 - prev.1;
        let angle = dy.atan2(dx);
        
        context.begin_path();
        context.move_to(end.0, end.1);
        context.line_to(end.0 - 12.0 * (angle - std::f64::consts::PI / 6.0).cos(), end.1 - 12.0 * (angle - std::f64::consts::PI / 6.0).sin());
        context.line_to(end.0 - 12.0 * (angle + std::f64::consts::PI / 6.0).cos(), end.1 - 12.0 * (angle + std::f64::consts::PI / 6.0).sin());
        context.line_to(end.0, end.1);
        context.set_fill_style(&JsValue::from_str(color));
        context.fill();
    }

    Ok(())
}