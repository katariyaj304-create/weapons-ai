import cv2
import numpy as np

def is_valid_image(image_path):
    # Load the image
    image = cv2.imread(image_path)
    if image is None:
        return False, "Image not found or unable to load."

    # Convert to grayscale for simplicity
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Define simple edge detection using Canny
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # Check for perspective angles by looking for specific patterns (simplified)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100, minLineLength=100, maxLineGap=10)
    if lines is not None:
        # Check for multiple angles
        angles = set()
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi
            angles.add(round(angle))
        if len(angles) < 3:  # Simplified check for multiple angles
            return False, "Perspective angles detected."

    # Check for busy environment (simplified)
    # Count number of edges as a heuristic for busyness
    num_edges = np.count_nonzero(edges)
    if num_edges > 5000:  # Arbitrary threshold for simplicity
        return False, "Highly busy environment detected."

    return True, "Image is valid."

if __name__ == "__main__":
    # Example usage
    image_path = "path/to/image.jpg"
    is_valid, message = is_valid_image(image_path)
    print(f"Is Valid: {is_valid}, Message: {message}")