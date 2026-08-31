from ultralytics import YOLO
import cv2
import os

# Load YOLO segmentation model
model = YOLO("yolo11n-seg.pt")

# Input image
image_path = "data/test.jpg"

# Check if image exists
if not os.path.exists(image_path):
    print("ERROR: test.jpg was not found!")
    print("Put an image inside the data folder and name it test.jpg")
    exit()

# Run YOLO segmentation
results = model(image_path)

# Save the result
for result in results:
    output = result.plot()
    cv2.imwrite("results/output.jpg", output)

print("Done!")
print("Result saved as: results/output.jpg")